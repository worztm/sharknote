//go:build !windows

package main

func pickAttachmentPath() ([]string, error) { return nil, errNotImplemented }

func saveAttachmentAs(defaultName string) (string, error) { return "", errNotImplemented }

func openPathWithDefaultApp(path string) error { return errNotImplemented }
