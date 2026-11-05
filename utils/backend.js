// 微信身份层：wx.login 取 code -> 后台 /api/auth/login 用 code 换 openId 并落 MySQL。
// 小程序端拿不到 openId，也绝不能持有 AppSecret；后台返回的 token 存在本机用于后续鉴权。

const http = require('./http');
const store = require('./store');

const APPID = 'wx75eaa2072b739e40';

function getWechatCode() {
    return new Promise(function (resolve) {
        if (typeof wx === 'undefined' || typeof wx.login !== 'function') {
            resolve('');
            return;
        }
        try {
            wx.login({
                success: function (res) {
                    resolve(res && res.code ? res.code : '');
                },
                fail: function () {
                    resolve('');
                },
            });
        } catch (error) {
            resolve('');
        }
    });
}

function signInWithWechat() {
    return getWechatCode().then(function (code) {
        return http.post('/api/auth/login', { code: code, appid: APPID });
    }).then(function (res) {
        if (res.error) return res;
        const body = res.data || {};
        if (body.token) http.setToken(body.token);
        return { data: body.user || null, error: null };
    });
}

function restoreUser() {
    if (!http.getToken()) {
        return Promise.resolve({ data: null, error: null });
    }
    return store.users.current().then(function (res) {
        if (res.error && (res.error.code === 'UNAUTHORIZED' || res.error.code === 'HTTP_401')) {
            http.clearToken();
            return { data: null, error: null };
        }
        return res;
    });
}

function signOut() {
    return http.post('/api/auth/logout', {}).then(function () {
        http.clearToken();
        return { data: null, error: null };
    });
}

function mask(value) {
    const text = String(value || '');
    return text.length > 10 ? text.slice(0, 6) + '***' + text.slice(-4) : text;
}

function describeOpenid(user) {
    if (!user) return { text: '未登录', wechatState: '' };
    if (user.openid_source === 'wechat') {
        return { text: mask(user.openid), wechatState: '微信 openId 已写入 MySQL' };
    }
    if (user.openid_source === 'dev') {
        return { text: mask(user.openid), wechatState: '开发联调标识（未换取真实 openId）' };
    }
    return { text: mask(user.openid), wechatState: '本机体验标识' };
}

module.exports = {
    appid: APPID,
    baseUrl: http.BASE_URL,
    signInWithWechat: signInWithWechat,
    restoreUser: restoreUser,
    signOut: signOut,
    describeOpenid: describeOpenid,
};
