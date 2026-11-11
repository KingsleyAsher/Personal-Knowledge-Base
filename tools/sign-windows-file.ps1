param(
 [Parameter(Mandatory=$true)][string]$FilePath,
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$Thumbprint,
 [string]$TimestampServer='http://timestamp.digicert.com'
)
$ErrorActionPreference='Stop'
$target=(Resolve-Path -LiteralPath $FilePath).Path
$cert=@(Get-ChildItem Cert:\CurrentUser\My,Cert:\LocalMachine\My -CodeSigningCert | Where-Object { $_.Thumbprint -eq $Thumbprint -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and $_.NotBefore -le (Get-Date) })
if($cert.Count -ne 1){throw 'Exactly one valid code-signing certificate with its private key must be installed.'}
if($cert[0].Subject -eq $cert[0].Issuer){throw 'A self-signed certificate is not accepted for product releases.'}
$chain=New-Object System.Security.Cryptography.X509Certificates.X509Chain
try {
 $chain.ChainPolicy.RevocationMode='Online'
 if(-not $chain.Build($cert[0])){throw 'Certificate trust or revocation verification failed.'}
} finally {$chain.Dispose()}
$result=Set-AuthenticodeSignature -LiteralPath $target -Certificate $cert[0] -HashAlgorithm SHA256 -TimestampServer $TimestampServer
$verified=Get-AuthenticodeSignature -LiteralPath $target
if($result.Status -ne 'Valid' -or $verified.Status -ne 'Valid' -or $verified.SignerCertificate.Thumbprint -ne $Thumbprint -or -not $verified.TimeStamperCertificate){throw 'A trusted, timestamped Authenticode signature could not be verified.'}
[pscustomobject]@{Path=$target;Status=[string]$verified.Status;Publisher=$verified.SignerCertificate.Subject;Thumbprint=$verified.SignerCertificate.Thumbprint} | ConvertTo-Json -Compress
