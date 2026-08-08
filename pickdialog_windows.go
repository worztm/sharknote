//go:build windows

// Native "open files" and "open folder" dialogs, driven directly through the
// IFileOpenDialog COM API (the same approach Notepad++ and others use).
//
// The Windows common file dialog cannot pick files and folders in the same
// mode, so there are two entry points: showOpenFilesDialog (multi-select
// markdown files) and showOpenFolderDialog (a single folder). The frontend
// surfaces them as separate "Open files" / "Open folder" buttons.

package main

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ---------- COM vtables (method order = ABI slot order) ---------------------

type iUnknownVtbl struct {
	QueryInterface uintptr
	AddRef         uintptr
	Release        uintptr
}

type iModalWindowVtbl struct {
	iUnknownVtbl
	Show uintptr // func (hwndOwner HWND) HRESULT
}

type iFileDialogVtbl struct {
	iModalWindowVtbl
	SetFileTypes        uintptr
	SetFileTypeIndex    uintptr
	GetFileTypeIndex    uintptr
	Advise              uintptr
	Unadvise            uintptr
	SetOptions          uintptr
	GetOptions          uintptr
	SetDefaultFolder    uintptr
	SetFolder           uintptr
	GetFolder           uintptr
	GetCurrentSelection uintptr
	SetFileName         uintptr
	GetFileName         uintptr
	SetTitle            uintptr
	SetOkButtonLabel    uintptr
	SetFileNameLabel    uintptr
	GetResult           uintptr
	AddPlace            uintptr
	SetDefaultExtension uintptr
	Close               uintptr
	SetClientGuid       uintptr
	ClearClientData     uintptr
	SetFilter           uintptr
}

type iFileOpenDialogVtbl struct {
	iFileDialogVtbl
	GetResults       uintptr
	GetSelectedItems uintptr
}

type iShellItemVtbl struct {
	iUnknownVtbl
	BindToHandler  uintptr
	GetParent      uintptr
	GetDisplayName uintptr
	GetAttributes  uintptr
	Compare        uintptr
}

type iShellItemArrayVtbl struct {
	iUnknownVtbl
	BindToHandler              uintptr
	GetPropertyStore           uintptr
	GetPropertyDescriptionList uintptr
	GetAttributes              uintptr
	GetCount                   uintptr
	GetItemAt                  uintptr
	EnumItems                  uintptr
}

type comDlgFilterSpec struct {
	pszName *uint16
	pszSpec *uint16
}

// ---------- GUIDs / constants ----------------------------------------------

var (
	clsidFileOpenDialog = guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")
	iidFileOpenDialog   = guid("D57C7288-D4AD-4768-BE02-9D969532D960")
)

const (
	clsctxInprocServer = 1
	coinitAptThreaded  = 0x2

	// FILEOPENDIALOGOPTIONS
	fosNoChangeDir      = 0x8
	fosPickFolders      = 0x20
	fosForceFileSystem  = 0x40
	fosAllowMultiselect = 0x200
	fosDontAddToRecent  = 0x2000000

	sigdnFilesyspath = 0x80058000

	// HRESULTs
	eCancelled = 0x800704C7 // HRESULT_FROM_WIN32(ERROR_CANCELLED)
)

func guid(s string) windows.GUID {
	var g windows.GUID
	if _, err := fmt.Sscanf(s, "%08x-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x",
		&g.Data1, &g.Data2, &g.Data3,
		&g.Data4[0], &g.Data4[1], &g.Data4[2], &g.Data4[3],
		&g.Data4[4], &g.Data4[5], &g.Data4[6], &g.Data4[7]); err != nil {
		panic("bad guid literal: " + s)
	}
	return g
}

func hrError(hr uintptr) error {
	return fmt.Errorf("COM operation failed with HRESULT 0x%08X", uint32(hr))
}

// ---------- COM plumbing ----------------------------------------------------

var (
	modOle32           = syscall.NewLazyDLL("ole32.dll")
	procCoInitializeEx = modOle32.NewProc("CoInitializeEx")
	procCoUninitialize = modOle32.NewProc("CoUninitialize")
	procCoCreateInst   = modOle32.NewProc("CoCreateInstance")
	procCoTaskMemFree  = modOle32.NewProc("CoTaskMemFree")
)

func coInitialize() {
	// Ignore the result: already-initialized (S_FALSE) and wrong-apartment
	// (RPC_E_CHANGED_MODE) are both tolerable — the dialog is hosted in an
	// STA either way.
	procCoInitializeEx.Call(0, coinitAptThreaded)
}

func unknownRelease(p unsafe.Pointer) {
	vtbl := (*iUnknownVtbl)(*(*unsafe.Pointer)(p))
	syscall.SyscallN(vtbl.Release, uintptr(p))
}

// shellItemPath extracts the filesystem path from an IShellItem.
func shellItemPath(item unsafe.Pointer) (string, error) {
	vtbl := (*iShellItemVtbl)(*(*unsafe.Pointer)(item))
	var psz *uint16
	hr, _, _ := syscall.SyscallN(vtbl.GetDisplayName, uintptr(item), sigdnFilesyspath,
		uintptr(unsafe.Pointer(&psz)))
	if int32(hr) < 0 {
		return "", hrError(hr)
	}
	defer procCoTaskMemFree.Call(uintptr(unsafe.Pointer(psz)))
	return windows.UTF16PtrToString(psz), nil
}

// showOpenFilesDialog shows a multi-select dialog restricted to markdown
// files. Returns the picked paths, or nil, nil when the user cancels.
func showOpenFilesDialog(owner uintptr, title string) ([]string, error) {
	return showOpenDialog(owner, title, false)
}

// showOpenFolderDialog shows a single-selection folder picker. Returns the
// picked folder, or nil, nil when the user cancels.
func showOpenFolderDialog(owner uintptr, title string) ([]string, error) {
	return showOpenDialog(owner, title, true)
}

// showOpenDialog drives one IFileOpenDialog. With folderMode the dialog
// selects a single folder (FOS_PICKFOLDERS); otherwise it multi-selects
// files (filtered to markdown).
func showOpenDialog(owner uintptr, title string, folderMode bool) ([]string, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	coInitialize()
	defer procCoUninitialize.Call()

	var fd unsafe.Pointer
	hr, _, _ := procCoCreateInst.Call(
		uintptr(unsafe.Pointer(&clsidFileOpenDialog)),
		0, clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidFileOpenDialog)),
		uintptr(unsafe.Pointer(&fd)))
	if int32(hr) < 0 {
		return nil, hrError(hr)
	}
	defer unknownRelease(fd)

	vtbl := (*iFileOpenDialogVtbl)(*(*unsafe.Pointer)(fd))

	// Filesystem-only, don't clobber our cwd or the recent list.
	opts := uintptr(fosForceFileSystem | fosNoChangeDir | fosDontAddToRecent)
	if folderMode {
		opts |= fosPickFolders
	} else {
		opts |= fosAllowMultiselect
	}
	hr, _, _ = syscall.SyscallN(vtbl.SetOptions, uintptr(fd), opts)
	if int32(hr) < 0 {
		return nil, hrError(hr)
	}

	titlePtr, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return nil, err
	}
	hr, _, _ = syscall.SyscallN(vtbl.SetTitle, uintptr(fd), uintptr(unsafe.Pointer(titlePtr)))
	if int32(hr) < 0 {
		return nil, hrError(hr)
	}

	// File mode: restrict to markdown (with an "All files" escape hatch).
	// Folder mode: label the confirm button accordingly. These pointers are
	// used by the dialog while it is open, so they must survive the Show
	// call below (see the KeepAlives at the end of the function).
	var okLabel, mdName, mdSpec, allName, allSpec *uint16
	var filters []comDlgFilterSpec
	if folderMode {
		okLabel, _ = windows.UTF16PtrFromString("Select folder")
		syscall.SyscallN(vtbl.SetOkButtonLabel, uintptr(fd), uintptr(unsafe.Pointer(okLabel)))
	} else {
		mdName, _ = windows.UTF16PtrFromString("Markdown files")
		mdSpec, _ = windows.UTF16PtrFromString("*.md")
		allName, _ = windows.UTF16PtrFromString("All files")
		allSpec, _ = windows.UTF16PtrFromString("*.*")
		filters = []comDlgFilterSpec{
			{pszName: mdName, pszSpec: mdSpec},
			{pszName: allName, pszSpec: allSpec},
		}
		hr, _, _ = syscall.SyscallN(vtbl.SetFileTypes, uintptr(fd), uintptr(len(filters)),
			uintptr(unsafe.Pointer(&filters[0])))
		if int32(hr) < 0 {
			return nil, hrError(hr)
		}
		syscall.SyscallN(vtbl.SetFileTypeIndex, uintptr(fd), 1)
	}

	hr, _, _ = syscall.SyscallN(vtbl.Show, uintptr(fd), owner)
	if uint32(hr) == uint32(eCancelled) {
		return nil, nil // user cancelled
	}
	if int32(hr) < 0 {
		return nil, hrError(hr)
	}	var paths []string
	if folderMode {
		// Single selection.
		var item unsafe.Pointer
		hr, _, _ = syscall.SyscallN(vtbl.GetResult, uintptr(fd), uintptr(unsafe.Pointer(&item)))
		if int32(hr) < 0 {
			return nil, hrError(hr)
		}
		defer unknownRelease(item)
		p, err := shellItemPath(item)
		if err != nil {
			return nil, err
		}
		paths = []string{p}
	} else {
		// Multi-select.
		var arr unsafe.Pointer
		hr, _, _ = syscall.SyscallN(vtbl.GetResults, uintptr(fd), uintptr(unsafe.Pointer(&arr)))
		if int32(hr) < 0 {
			return nil, hrError(hr)
		}
		defer unknownRelease(arr)
		avtbl := (*iShellItemArrayVtbl)(*(*unsafe.Pointer)(arr))
		var count uint32
		hr, _, _ = syscall.SyscallN(avtbl.GetCount, uintptr(arr), uintptr(unsafe.Pointer(&count)))
		if int32(hr) < 0 {
			return nil, hrError(hr)
		}
		for i := uint32(0); i < count; i++ {
			var item unsafe.Pointer
			hr, _, _ = syscall.SyscallN(avtbl.GetItemAt, uintptr(arr), uintptr(i),
				uintptr(unsafe.Pointer(&item)))
			if int32(hr) < 0 {
				continue
			}
			p, err := shellItemPath(item)
			unknownRelease(item)
			if err == nil {
				paths = append(paths, p)
			}
		}
	}
	// The dialog keeps using these strings until it closes, so they must
	// stay pinned in memory for the whole call — the GC would otherwise be
	// free to reclaim them after their last source-level use.
	runtime.KeepAlive(titlePtr)
	runtime.KeepAlive(okLabel)
	runtime.KeepAlive(mdName)
	runtime.KeepAlive(mdSpec)
	runtime.KeepAlive(allName)
	runtime.KeepAlive(allSpec)
	runtime.KeepAlive(filters)
	return paths, nil
}
