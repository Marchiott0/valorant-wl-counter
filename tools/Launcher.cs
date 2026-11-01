using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher
{
    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(root, "tools", "start.ps1");
        if (!File.Exists(script))
        {
            MessageBox.Show("Mantenha o executavel e as pastas tools, src, public e runtime juntos.", "Valorant W/L Counter");
            return 1;
        }
        bool check = Array.IndexOf(args, "--check") >= 0;
        bool noBrowser = Array.IndexOf(args, "--no-browser") >= 0;
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
        info.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -Gui" + (check ? " -CheckOnly" : "") + (noBrowser ? " -NoBrowser" : "");
        info.WorkingDirectory = root;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        try
        {
            using (Process process = Process.Start(info))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch
        {
            MessageBox.Show("Nao foi possivel abrir o programa. Tente iniciar.bat nesta mesma pasta.", "Valorant W/L Counter");
            return 1;
        }
    }
}
