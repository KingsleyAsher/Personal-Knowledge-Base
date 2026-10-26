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

    def _redact(self, value):
        text = redact(value)
        if self.token:
            from urllib.parse import quote
            text = text.replace(self.token, '[redacted]').replace(quote(self.token, safe=''), '[redacted]')
        return text[:800]

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
            raise APIError(self.platform, method, route, error.code, self._redact(detail)) from None
        except (urllib.error.URLError, TimeoutError):
            raise APIError(self.platform, method, route, 'network', self._redact('connection failed or timed out')) from None

    def repo(self, route='', **kwargs):
        return self.request('/repos/' + PROJECT + route, **kwargs)
