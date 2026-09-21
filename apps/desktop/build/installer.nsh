; Extra registration so PDFX is listed under "Open with" and in Settings >
; Default apps for .pdf. The user's current default is never changed.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "PDFX.Document" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\PDFX.exe\SupportedTypes" ".pdf" ""
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "PDFX.Document"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\PDFX.exe"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
