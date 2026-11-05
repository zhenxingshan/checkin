const backend = require('./utils/backend');

App({
    globalData: {
        user: null,
    },

    onLaunch() {
        // 用本机 token 向后台恢复登录态；页面统一等待 ready 后再渲染，避免登录态闪烁。
        this.ready = backend.restoreUser().then((res) => {
            this.globalData.user = res.data || null;
            return this.globalData.user;
        }).catch(() => {
            this.globalData.user = null;
            return null;
        });
    },

    setUser(user) {
        this.globalData.user = user;
    },
});
