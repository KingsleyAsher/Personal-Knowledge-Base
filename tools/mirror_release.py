"""Small release API client shared by mirror publishing and diagnostics.

API tokens stay in process memory / Actions Secrets. Never log request URLs.
"""
import json
import os
import re
import urllib.error
import urllib.request
from urllib.parse import quote, urlencode

PROJECT = 'KingsleyAsher/Personal-Knowledge-Base'


def redact(value):
    text = str(value)
    for name in ('GITEE_TOKEN', 'GITCODE_TOKEN', 'MIRROR_TOKEN'):
        token = os.environ.get(name)
        if token:
            text = text.replace(token, '[redacted]').replace(quote(token, safe=''), '[redacted]')
    text = re.sub(r'https?://[^\s<>"\']+', '[remote URL]', text)
    return text[:800]


class APIError(RuntimeError):
    def __init__(self, platform, method, route, status, detail=''):
        self.status = status
        super().__init__(f'{platform} API {method} {route}: HTTP {status}; {redact(detail)}')


class MirrorAPI:
    def __init__(self, platform, token=None, opener=urllib.request.urlopen):
        if platform not in ('gitee', 'gitcode'):
            raise ValueError('Unsupported mirror platform')
        self.platform = platform
        self.token = token or os.environ.get(platform.upper() + '_TOKEN')
        if not self.token:
            raise RuntimeError('Missing repository Actions Secret: ' + platform.upper() + '_TOKEN')
        self.host = 'https://gitee.com' if platform == 'gitee' else 'https://api.gitcode.com'
        self.opener = opener

    def request(self, route, method='GET', data=None, query=None, missing=False, raw=False, headers=None):
        params = {**(query or {}), 'access_token': self.token}
        url = self.host + '/api/v5' + route + '?' + urlencode(params)
        request_headers = {'User-Agent': 'knowledge-base-mirror-release', 'Accept': 'application/json', **(headers or {})}
        payload = data
        if data is not None and not isinstance(data, bytes):
            payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
            request_headers['Content-Type'] = 'application/json'
        try:
            request = urllib.request.Request(url, data=payload, method=method, headers=request_headers)
            with self.opener(request, timeout=90) as response:
                body = response.read()
                return body if raw else json.loads(body) if body else {}
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            try:
                body = json.loads(error.read(8192))
                detail = body.get('message') or body.get('error_description') or body.get('error') or 'request refused'
            except (ValueError, AttributeError):
                detail = 'request refused'
            raise APIError(self.platform, method, route, error.code, detail) from None
        except (urllib.error.URLError, TimeoutError):
            raise APIError(self.platform, method, route, 'network', 'connection failed or timed out') from None

    def repo(self, route='', **kwargs):
        return self.request('/repos/' + PROJECT + route, **kwargs)

    def sync_pull(self, project_id):
        """The same operation as GitCode's web UI 'sync mirror' button.

        Contract: official site's assets/index-2b342e54.js, function rm.
        It does not replace the source URL, credentials or mirror policy.
        """
        if self.platform != 'gitcode' or not str(project_id).isdigit():
            raise ValueError('A GitCode numeric project ID is required')
        route = '/api/v2/projects/' + str(project_id) + '/sync_remote_mirror'
        request = urllib.request.Request('https://web-api.gitcode.com' + route, data=b'{}', method='POST',
            headers={'Authorization': 'Bearer ' + self.token, 'PRIVATE-TOKEN': self.token, 'Content-Type': 'application/json', 'User-Agent': 'knowledge-base-mirror-release'})
        try:
            with self.opener(request, timeout=60) as response:
                result = json.load(response)
            if result.get('success') is False:
                raise APIError('gitcode', 'POST', route, result.get('code'), result.get('message', 'mirror pull refused'))
            return result
        except urllib.error.HTTPError as error:
            raise APIError('gitcode', 'POST', route, error.code, 'mirror sync endpoint rejected the token') from None
        except (urllib.error.URLError, TimeoutError, ValueError):
            raise APIError('gitcode', 'POST', route, 'network', 'mirror sync did not return valid JSON') from None
