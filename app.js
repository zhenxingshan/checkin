const backend = require('./utils/backend');

App({
    globalData: {
        user: null,
    },

    onLaunch() {
        // 冷启动即静默登录：复用本机 token，失效或首次进入自动用 wx.login 换 openId。
        // 页面统一等待 ready 后再渲染，避免登录态闪烁，也无需用户点任何登录按钮。
        this.ready = backend.ensureLogin().then((res) => {
            const result = res || { data: null, error: null };
            this.globalData.user = result.error ? null : (result.data || null);
            return result;
        }).catch(() => {
            this.globalData.user = null;
            return { data: null, error: null };
        });
    },

    onShow() {
        // 从后台回到前台时静默校验登录态：token 过期会自动重新 wx.login，用户无感。
        // 不覆盖 ready，避免页面拿到的登录结果被中途改写。
        backend.ensureLogin().then((res) => {
            if (res && !res.error && res.data) this.globalData.user = res.data;
        }).catch(() => {});
    },

    setUser(user) {
        this.globalData.user = user;
    },
});
