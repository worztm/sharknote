//go:build windows

package main

import (
	"log"
	"os/exec"
	"syscall"
)

// runPowerShellToast fires a Windows toast via the WinRT runtime, hidden
// window, detached from our lifetime so a hung toast cannot block the poller.
func runPowerShellToast(title, body string) {
	ps := `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$tmpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$nodes = $tmpl.GetElementsByTagName("text")
$nodes.Item(0).AppendChild($tmpl.CreateTextNode('` + psEscape(title) + `')) | Out-Null
$nodes.Item(1).AppendChild($tmpl.CreateTextNode('` + psEscape(body) + `')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($tmpl)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Sharknote').Show($toast)
`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		log.Printf("toast start failed: %v", err)
		return
	}
	go func() { _ = cmd.Wait() }()
}

// psEscape makes s safe inside a PowerShell single-quoted literal.
func psEscape(s string) string {
	out := make([]byte, 0, len(s)+8)
	for i := 0; i < len(s); i++ {
		if s[i] == '\'' {
			out = append(out, '\'', '\'')
		} else {
			out = append(out, s[i])
		}
	}
	return string(out)
}
