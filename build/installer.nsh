; POTACAT installer customization — diagnostic logging
; Logs install steps to potacat-install.log next to the installer .exe
; so users can send the log when installation fails silently.

!define LOG_FILE "$EXEDIR\potacat-install.log"

; Helper: append a line to the log file
!macro _LogWrite text
  FileOpen $9 "${LOG_FILE}" a
  StrCmp $9 "" +3
    FileWrite $9 "${text}$\r$\n"
    FileClose $9
!macroend

; Kill the Remote Launcher (scripts/launcher.js) if it's running as a
; POTACAT.exe — the "POTACAT cannot be closed / old version won't
; uninstall" bug (K6RBJ + others, 2026-06-13).
;
; The launcher auto-starts at logon. On a machine WITHOUT system Node it
; runs as the install-dir Electron binary with ELECTRON_RUN_AS_NODE
; (POTACAT.exe <userData>\launcher.js). Windows locks a running .exe's
; image file, so that background POTACAT.exe (a) keeps
; <INSTDIR>\POTACAT.exe locked and (b) trips electron-builder's
; "is the app running" check — the GUI closes gracefully but the
; launcher survives, so the installer loops on "cannot be closed" and
; the uninstaller can't delete the folder.
;
; The Name='POTACAT.exe' filter is deliberate and load-bearing:
;   - the killer (powershell.exe) never matches itself, even though this
;     command line contains the literal "launcher.js"
;   - the GUI POTACAT.exe has no launcher.js in its command line, so
;     the stock check below still handles it gracefully
;   - a node.exe launcher (system-Node users) isn't matched, and doesn't
;     need to be — it runs from %APPDATA% and never locks INSTDIR.
!macro _KillLauncher
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'POTACAT.exe' -and $$_.CommandLine -like '*launcher.js*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  !insertmacro _LogWrite "KillLauncher: stop launcher POTACAT.exe rc=$0"
  ; Give Windows a moment to release the .exe image lock before file ops.
  Sleep 800
!macroend

; electron-builder calls CHECK_APP_RUNNING for BOTH the installer
; section and the uninstaller (un.checkAppRunning). When customCheckAppRunning
; is defined it REPLACES the stock body, so we kill the launcher first
; and then run the exact stock check (IS_POWERSHELL_AVAILABLE +
; _CHECK_APP_RUNNING) — preserving the graceful GUI-close prompt while
; making sure the headless launcher can't keep tripping it. One hook
; fixes upgrade AND uninstall. NOTE: this calls electron-builder
; internals (_CHECK_APP_RUNNING); if a future bump renames them the
; Windows build fails loudly at makensis time (not a silent ship).
!macro customCheckAppRunning
  !insertmacro _LogWrite "customCheckAppRunning: stopping launcher, then stock app-running check"
  !insertmacro _KillLauncher
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

!macro customInstall
  !insertmacro _LogWrite "customInstall: Installing to $INSTDIR"

  ; Verify the main exe was written
  IfFileExists "$INSTDIR\POTACAT.exe" 0 +3
    !insertmacro _LogWrite "customInstall: POTACAT.exe EXISTS - install appears successful"
    Goto +2
    !insertmacro _LogWrite "customInstall: WARNING - POTACAT.exe NOT FOUND after install"

  ; Register potacat:// protocol handler
  WriteRegStr HKCU "Software\Classes\potacat" "" "URL:POTACAT Protocol"
  WriteRegStr HKCU "Software\Classes\potacat" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\potacat\shell\open\command" "" '"$INSTDIR\POTACAT.exe" "%1"'
  !insertmacro _LogWrite "customInstall: Registered potacat:// protocol handler"

  !insertmacro _LogWrite "customInstall: Complete"
!macroend

!macro customUnInstall
  ; Remove potacat:// protocol handler
  DeleteRegKey HKCU "Software\Classes\potacat"
!macroend
