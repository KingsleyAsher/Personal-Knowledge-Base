using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Windows.Forms;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Text;
class Bootstrap {
 static string temp;
 [STAThread] static void Main(string[] args) {
  Application.EnableVisualStyles();
  if(Path.GetFileName(Application.ExecutablePath).Equals("Uninstall.exe",StringComparison.OrdinalIgnoreCase)){
   string helperDir=Path.Combine(Path.GetTempPath(),"KnowledgeWorkbench-UninstallHost",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(helperDir);string helper=Path.Combine(helperDir,"UninstallHost.exe");File.Copy(Application.ExecutablePath,helper);Process.Start(new ProcessStartInfo(helper,"--uninstall-source="+Quote(Path.GetDirectoryName(Application.ExecutablePath))){UseShellExecute=false,CreateNoWindow=true});return;
  }
  var form=new Form {Text="知识工作台 · 准备安装",Icon=System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath),Width=420,Height=140,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false};
  var label=new Label {Text="正在准备安装界面…",Left=24,Top=20,Width=360,Height=24};
  var bar=new ProgressBar {Left=24,Top=54,Width=356,Height=12,Style=ProgressBarStyle.Marquee};form.Controls.Add(label);form.Controls.Add(bar);
  form.Shown+=async (s,e)=>{try{var start=await Task.Run(()=>Prepare(args));form.Hide();using(var child=Process.Start(start)){await Task.Run(()=>child.WaitForExit());}form.Close();}catch(Exception ex){MessageBox.Show(ex.Message,"无法启动安装程序",MessageBoxButtons.OK,MessageBoxIcon.Error);form.Close();}finally{if(temp!=null){try{var root=Path.GetFullPath(Path.Combine(Path.GetTempPath(),"KnowledgeWorkbench-Setup"))+Path.DirectorySeparatorChar;if(Path.GetFullPath(temp).StartsWith(root,StringComparison.OrdinalIgnoreCase))Directory.Delete(temp,true);}catch{}}}};
  Application.Run(form);
 }
 static string Quote(string s){return "\""+s.Replace("\"","")+"\"";}
 static ProcessStartInfo Prepare(string[] args){
  var self=Application.ExecutablePath;temp=Path.Combine(Path.GetTempPath(),"KnowledgeWorkbench-Setup",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temp);
  string uninstall=null;
  foreach(string a in args)if(a.StartsWith("--uninstall-source="))uninstall=Path.GetFullPath(a.Substring(19));
  if(uninstall!=null){
   if(!File.Exists(Path.Combine(uninstall,"INSTALL-MANIFEST.json")))throw new Exception("找不到安装记录，无法安全卸载。");
   // Copy only the Electron runtime; never open personal data or load the app.
   string[] runtimeFiles={"KnowledgeWorkbench-Candidate.exe","chrome_100_percent.pak","chrome_200_percent.pak","d3dcompiler_47.dll","dxcompiler.dll","electron_wer.dll","ffmpeg.dll","icudtl.dat","resources.pak","snapshot_blob.bin","v8_context_snapshot.bin","vk_swiftshader_icd.json","vk_swiftshader.dll","vulkan-1.dll"};
   foreach(var name in runtimeFiles){var f=Path.Combine(uninstall,name);if(File.Exists(f))File.Copy(f,Path.Combine(temp,name),true);}
   CopyDir(Path.Combine(uninstall,"locales"),Path.Combine(temp,"locales"));
   Directory.CreateDirectory(Path.Combine(temp,"resources"));
   File.Copy(Path.Combine(uninstall,"resources","installer-ui.asar"),Path.Combine(temp,"resources","app.asar"));
  }else{
   using(var f=File.OpenRead(self)){
    if(f.Length<48)throw new Exception("安装包不完整。");f.Position=f.Length-48;var trailer=new byte[48];f.Read(trailer,0,48);
    if(Encoding.ASCII.GetString(trailer,40,8)!="KBSETUP1")throw new Exception("安装包标记无效。");
    long length=BitConverter.ToInt64(trailer,0),offset=f.Length-48-length;
    if(length<=0||offset<0)throw new Exception("安装包长度无效。");
    string zip=Path.Combine(temp,"payload.zip");f.Position=offset;
    using(var dest=File.Create(zip)){byte[] buffer=new byte[1024*1024];long remaining=length;while(remaining>0){int n=f.Read(buffer,0,(int)Math.Min(buffer.Length,remaining));if(n<=0)throw new Exception("安装包被截断。");dest.Write(buffer,0,n);remaining-=n;}}
    using(var zipFile=File.OpenRead(zip))using(var sha=SHA256.Create()){var hash=sha.ComputeHash(zipFile);for(int i=0;i<32;i++)if(hash[i]!=trailer[i+8])throw new Exception("安装包校验失败，请重新获取安装包。");}
    using(var archive=ZipFile.OpenRead(zip)){foreach(var entry in archive.Entries){var target=Path.GetFullPath(Path.Combine(temp,entry.FullName));if(!target.StartsWith(temp+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("安装包路径无效。");if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(target);continue;}Directory.CreateDirectory(Path.GetDirectoryName(target));entry.ExtractToFile(target,true);}}File.Delete(zip);
   }
  }
  var cmd=uninstall==null?"":"--uninstall-target="+Quote(uninstall);
  var start=new ProcessStartInfo(Path.Combine(temp,"KnowledgeWorkbench-Candidate.exe"),cmd){WorkingDirectory=temp,UseShellExecute=false,CreateNoWindow=true};
  start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");start.EnvironmentVariables["KB_SETUP_SESSION"]=temp;return start;
 }
 static void CopyDir(string src,string dst){Directory.CreateDirectory(dst);foreach(var f in Directory.GetFiles(src))File.Copy(f,Path.Combine(dst,Path.GetFileName(f)));foreach(var d in Directory.GetDirectories(src))CopyDir(d,Path.Combine(dst,Path.GetFileName(d)));}
}
