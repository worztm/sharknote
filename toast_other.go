//go:build !windows

package main

// runPowerShellToast is a no-op off Windows; alarms still emit the frontend
// event so an in-app banner covers the notification there.
func runPowerShellToast(title, body string) {}
