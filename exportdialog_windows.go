//go:build windows

// Native "Save As" dialog, driven directly through GetSaveFileNameW
// (comdlg32). Unlike IFileOpenDialog there is no COM vtable plumbing here:
// the classic common dialog API is stable, well documented and sufficient —
// it also gives us the overwrite prompt for free. The user can navigate to
// any folder (Documents, Downloads, Desktop, …) and the default file name
// is preselected, so typing an existing name confirms the overwrite prompt.

package main

import (
	"errors"
	"syscall"
	"unsafe"
)

// OPENFILENAMEW — layout matches the 64-bit Windows definition exactly:
// DWORDs and pointer fields interleaved; Go's alignment rules produce the
// same offsets (pointer fields 8-aligned, WORD fields 2-aligned).
type openFileNameW struct {
	lStructSize       uint32
	hwndOwner         uintptr
	hInstance         uintptr
	lpstrFilter       *uint16
	lpstrCustomFilter *uint16
	nMaxCustFilter    uint32
	nFilterIndex      uint32
	lpstrFile         *uint16
	nMaxFile          uint32
	lpstrFileTitle    *uint16
	nMaxFileTitle     uint32
	lpstrInitialDir   *uint16
	lpstrTitle        *uint16
	Flags             uint32
	nFileOffset       uint16
	nFileExtension    uint16
	lpstrDefExt       *uint16
	lCustData         uintptr
	lpfnHook          uintptr
	lpTemplateName    *uint16
}

// Common dialog flags (commdlg.h).
const (
	ofnOverwritePrompt = 0x00000002
	ofnHideReadOnly    = 0x00000004
	ofnNoChangeDir     = 0x00000008
	ofnPathMustExist   = 0x00000800
	ofnExplorer        = 0x00080000
	ofnLongNames       = 0x00200000
)

// maxFilePath is the buffer for the returned path — the modern maximum path
// length on Windows (the dialog can return names longer than MAX_PATH).
const maxFilePath = 32768

var (
	modComdlg32              = syscall.NewLazyDLL("comdlg32.dll")
	procGetSaveFileNameW     = modComdlg32.NewProc("GetSaveFileNameW")
	procCommDlgExtendedError = modComdlg32.NewProc("CommDlgExtendedError")
)

// saveDialogFilter is the type dropdown shown in the dialog. The final empty
// string terminates the double-null-terminated list.
var saveDialogFilter = []string{
	"Markdown (*.md)", "*.md",
	"HTML page (*.html)", "*.html;*.htm",
	"Plain text (*.txt)", "*.txt",
	"All files (*.*)", "*.*",
}

// showSaveFileDialog asks the user where to save a file. defaultName is
// preselected in the file name field (may include a relative path). Returns
// the chosen full path, or "" when the user cancels.
func showSaveFileDialog(owner uintptr, defaultName string) (string, error) {
	var filter []uint16
	for _, part := range saveDialogFilter {
		filter = append(filter, syscall.StringToUTF16(part)...)
	}
	filter = append(filter, 0, 0) // double null terminator

	// The caller's string is read-only; the dialog writes into its own buffer.
	fileBuf := make([]uint16, maxFilePath)
	copy(fileBuf, syscall.StringToUTF16(defaultName))

	ofn := &openFileNameW{
		lStructSize:     uint32(unsafe.Sizeof(openFileNameW{})),
		hwndOwner:       owner,
		lpstrFilter:     &filter[0],
		nFilterIndex:    1, // Markdown first
		lpstrFile:       &fileBuf[0],
		nMaxFile:        maxFilePath,
		lpstrInitialDir: nil, // Windows starts at Documents / last-used folder
		Flags:           ofnOverwritePrompt | ofnHideReadOnly | ofnNoChangeDir | ofnPathMustExist | ofnExplorer | ofnLongNames,
	}

	ret, _, _ := procGetSaveFileNameW.Call(uintptr(unsafe.Pointer(ofn)))
	if ret != 0 {
		return syscall.UTF16ToString(fileBuf), nil
	}
	// 0 can mean "cancelled" (CommDlgExtendedError() == 0) or a real failure.
	if code, _, _ := procCommDlgExtendedError.Call(); code != 0 {
		return "", errors.New("save dialog failed")
	}
	return "", nil // user cancelled
}