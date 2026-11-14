using System;
using System.IO;
using System.Text;

// Authenticode appends a WIN_CERTIFICATE table after the installer payload.
// Locate the authenticated payload trailer before that table, allowing only the
// alignment padding inserted by the signer. The ZIP is still hash-verified.
public static class PayloadLayout {
 static bool Marker(Stream file,long end) {
  if(end<48||end>file.Length)return false;
  var value=new byte[8];file.Position=end-8;
  return file.Read(value,0,8)==8&&Encoding.ASCII.GetString(value)=="KBSETUP1";
 }
 public static long FindEnd(Stream file) {
  var reader=new BinaryReader(file,Encoding.UTF8,true);
  if(file.Length<64)throw new InvalidDataException("安装包不完整。");
  file.Position=0;if(reader.ReadUInt16()!=0x5a4d)throw new InvalidDataException("安装器 PE 头无效。");
  file.Position=0x3c;long pe=reader.ReadUInt32();
  if(pe<64||pe>file.Length-24)throw new InvalidDataException("安装器 PE 偏移无效。");
  file.Position=pe;if(reader.ReadUInt32()!=0x4550)throw new InvalidDataException("安装器 PE 标记无效。");
  file.Position=pe+20;int optionalSize=reader.ReadUInt16();long optional=pe+24;
  if(optionalSize<2||optional+optionalSize>file.Length)throw new InvalidDataException("安装器 PE 目录无效。");
  file.Position=optional;int magic=reader.ReadUInt16();int directories=magic==0x20b?112:magic==0x10b?96:0;
  if(directories==0||optionalSize<directories+40)throw new InvalidDataException("安装器 PE 类型无效。");
  file.Position=optional+directories-4;uint count=reader.ReadUInt32();
  uint certOffset=0,certSize=0;
  if(count>4){file.Position=optional+directories+32;certOffset=reader.ReadUInt32();certSize=reader.ReadUInt32();}
  if(certOffset==0&&certSize==0){if(Marker(file,file.Length))return file.Length;throw new InvalidDataException("安装包标记无效。");}
  if(certOffset%8!=0||certSize<8||certOffset<optional+optionalSize||(long)certOffset+certSize!=file.Length)throw new InvalidDataException("安装器签名目录无效。");
  file.Position=certOffset;uint length=reader.ReadUInt32();
  if(length<8||length>certSize)throw new InvalidDataException("安装器签名长度无效。");
  for(int padding=0;padding<8;padding++){
   long end=(long)certOffset-padding;
   if(!Marker(file,end))continue;
   file.Position=end;for(int i=0;i<padding;i++)if(file.ReadByte()!=0)throw new InvalidDataException("安装器对齐数据无效。");
   return end;
  }
  throw new InvalidDataException("签名安装包缺少有效载荷标记。");
 }
}
