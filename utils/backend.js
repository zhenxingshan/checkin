// 微信身份层：wx.login 取 code -> 后台 /api/auth/login 用 code 换 openId 并落 MySQL。
// 小程序端拿不到 openId，也绝不能持有 AppSecret；后台返回的 token 存在本机用于后续鉴权。
// 登录是静默的：冷启动自动完成，页面不需要任何「登录」按钮，也不会弹授权框。

const http = require('./http');
const store = require('./store');

const APPID = 'wx75eaa2072b739e40';

// 同一时刻只允许一个登录流程；页面与 App 共用，避免重复 wx.login。
let loginPromise = null;

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
        if (!body.token || !body.user) {
            return { data: null, error: { code: 'LOGIN_FAILED', message: '登录信息不完整，请重试' } };
        }
        http.setToken(body.token);
        return { data: body.user, error: null };
    });
}

// 静默登录失败自动重试一次，避免 wx.login / 网络抖动让首屏停在错误态。
function silentSignIn(retryLeft) {
    return signInWithWechat().then(function (res) {
        if ((res.error || !res.data) && retryLeft > 0) return silentSignIn(retryLeft - 1);
        if (!res.error && !res.data) {
            return { data: null, error: { code: 'LOGIN_FAILED', message: '自动登录失败，请重试' } };
        }
        return res;
    }).catch(function () {
        if (retryLeft > 0) return silentSignIn(retryLeft - 1);
        return { data: null, error: { code: 'LOGIN_FAILED', message: '自动登录失败，请重试' } };
    });
}

/**
 * 冷启动入口：有 token 就恢复用户；token 失效、首次进入则自动 wx.login 换 openId。
 * 全程无点击、无授权弹窗；失败后再次调用即可重试。
 */
function ensureLogin() {
    if (loginPromise) return loginPromise;
    loginPromise = restoreUser().then(function (res) {
        if (res.error) return res;
        if (res.data && res.data.logged_in !== false) return res;
        return silentSignIn(1);
    }).catch(function () {
        return { data: null, error: { code: 'LOGIN_FAILED', message: '自动登录失败，请重试' } };
    }).then(function (res) {
        loginPromise = null;
        return res;
    });
    return loginPromise;
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

function mask(value) {
    const text = String(value || '');
    return text.length > 10 ? text.slice(0, 6) + '***' + text.slice(-4) : text;
}

// 「我的」页只展示脱敏后的 openId，不暴露登录来源等内部状态。
function maskOpenid(user) {
    return user && user.openid ? mask(user.openid) : '未登录';
}

module.exports = {
    appid: APPID,
    baseUrl: http.BASE_URL,
    signInWithWechat: signInWithWechat,
    ensureLogin: ensureLogin,
    restoreUser: restoreUser,
    maskOpenid: maskOpenid,
};
