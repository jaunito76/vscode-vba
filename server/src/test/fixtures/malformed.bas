Attribute VB_Name = "Malformed"
Option Explicit

Public Sub BeforeError()
    Dim x As Integer
    x = 1
End Sub

Public Sub HasSyntaxError()
    Dim y As
    y = )))
End Sub

Public Sub AfterError()
    Dim z As Integer
    z = 2
End Sub
