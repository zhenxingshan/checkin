// 后台接口层：统一封装 wx.request、X-Token 凭证与 { data, error } 响应形状。
//
// 联调：BASE_URL 指向本机 Spring Boot（微信开发者工具需关闭「校验合法域名」）。
// 上线：改成已配置 request 合法域名的 https 地址，并把 project.config.json 的 urlCheck 改回 true。
// 真机预览不能用 localhost，要填电脑的局域网 IP 或公网域名。

const BASE_URL = 'http://localhost:8080';
const TOKEN_KEY = 'daily_checkin_token';

function readToken() {
    try {
        return wx.getStorageSync(TOKEN_KEY) || '';
    } catch (error) {
        return '';
    }
}

function writeToken(token) {
    try {
        wx.setStorageSync(TOKEN_KEY, token || '');
    } catch (error) {
        // 存储不可用时仅本次会话可用，不阻断主流程。
    }
}

function clearToken() {
    writeToken('');
}

function buildQuery(query) {
    if (!query) return '';
    const parts = [];
    Object.keys(query).forEach(function (key) {
        const value = query[key];
        if (value === undefined || value === null || value === '') return;
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    return parts.length ? '?' + parts.join('&') : '';
}

function request(method, path, data, query) {
    return new Promise(function (resolve) {
        const header = { 'content-type': 'application/json' };
        const token = readToken();
        if (token) header['X-Token'] = token;
        try {
            wx.request({
                url: BASE_URL + path + buildQuery(query),
                method: method,
                data: data || {},
                header: header,
                timeout: 10000,
                success: function (res) {
                    const status = res && res.statusCode;
                    const body = res && res.data;
                    if (status === 200 && body && typeof body === 'object' && !Array.isArray(body)) {
                        resolve({
                            data: Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : null,
                            error: body.error || null,
                        });
                        return;
                    }
                    resolve({
                        data: null,
                        error: {
                            code: 'HTTP_' + (status || 'ERROR'),
                            message: '后台服务异常（HTTP ' + (status || '?') + '）',
                        },
                    });
                },
                fail: function () {
                    resolve({
                        data: null,
                        error: { code: 'NETWORK_ERROR', message: '连接后台失败，请确认服务已启动' },
                    });
                },
            });
        } catch (error) {
            resolve({
                data: null,
                error: { code: 'CLIENT_EXCEPTION', message: '请求异常，请重试' },
            });
        }
    });
}

module.exports = {
    BASE_URL: BASE_URL,
    getToken: readToken,
    setToken: writeToken,
    clearToken: clearToken,
    get: function (path, query) { return request('GET', path, null, query); },
    post: function (path, data) { return request('POST', path, data, null); },
    put: function (path, data) { return request('PUT', path, data, null); },
    del: function (path) { return request('DELETE', path, null, null); },
};
