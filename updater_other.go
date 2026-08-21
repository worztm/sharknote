//go:build !windows

package main

import "os/exec"

// launchDetached starts a process detached from the app (non-Windows builds;
// the updater itself only ships on Windows, this keeps cross-compilation).
func launchDetached(name string, args ...string) error {
	return exec.Command(name, args...).Start()
}
