//go:build !windows

package main

// registerFileAssociation is a no-op on non-Windows platforms.
func registerFileAssociation() error { return nil }
