# Windows installation trust / Windows 安装信任

The existing 2.0.2 local installer is unsigned. It may be rejected by Smart App Control or organization policy. Local antivirus checks and hashes do not establish Windows trust, and results on the build computer do not diagnose another computer.

现有 2.0.2 本地安装器未签名，可能被智能应用控制或组织策略拦截。构建机检查结果不能代表另一台目标电脑。正式签名仍需发布者取得可信证书/签名服务授权；本次源码修改并未生成签名制品。

## Certificate-backed build / 本地证书签名构建

Install a legitimate code-signing certificate with its private key in the Windows CurrentUser/My or LocalMachine/My certificate store using the issuer's supported installation procedure. Do not commit certificates, private keys or passwords. The build accepts only the public SHA-1 certificate thumbprint through KB_SIGN_CERT_SHA1.

```powershell
$env:KB_SIGN_CERT_SHA1 = '<40 hexadecimal certificate thumbprint>'
python -X utf8 installer-design-b/installer/build.py
```

The build signs executable payload files after mutation and before calculating installation hashes, then signs the complete outer installer. SHA-256 and release metadata are calculated after signing. The script requires a valid chain, matching publisher and timestamp and rejects self-signed certificates. Any issuer or timestamp failure stops the build.

Local development only: `python -X utf8 installer-design-b/installer/build.py --allow-unsigned`. This does not fix Smart App Control or produce a release suitable for restricted systems.

安装器会签名后再计算最终文件哈希；签名前的旧哈希和旧签名不能继续使用。项目证书的授权范围必须由签名服务确认，尤其不能未经许可用开源项目证书重新签名第三方上游程序。

## Cloud or open-source signing / 云签名与开源签名

[Microsoft code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) describe trusted certificates and services. [SignPath Foundation](https://signpath.org/) offers free signing to qualifying open-source projects, subject to [eligibility and build-origin review](https://signpath.org/terms). Approval is not automatic. This repository has not been approved or connected to SignPath; its account, signing API, artifact restrictions, third-party binary treatment and manual release approvals must be configured before use. The local-certificate helper does not by itself integrate cloud signing.

开源免费签名可申请，但不能保证通过，也不能把申请材料当作已经签名。需要项目所有者注册并完成审批；签名服务可能要求可验证 CI 构建、人工发布批准及上游组件单独处理。微软 Artifact Signing 还受发布者所在地区限制，应先核对官方资格条件。

## Validation boundaries / 验证边界

The C# payload-layout tests use synthetic certificate-table fixtures. They verify parsing and alignment only, not cryptographic trust. End-to-end validation must sign with a real authorized certificate, verify every signature, install on the affected machine under its existing policy, launch the client and complete first-library setup. Organization allowlisting may still be required. Keep the old installation for rollback.
