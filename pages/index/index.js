const store = require('../../utils/store');
const backend = require('../../utils/backend');
const dateUtil = require('../../utils/date');

const TASK_ICONS = ['🌱', '📚', '🏃', '💧', '🧘', '🎯', '☀️', '✍️'];
const TASK_COLORS = ['#4C6FFF', '#00B894', '#FF8A4C', '#A66CFF', '#F26D8B', '#2C9CDB'];
const AVATAR_PRESETS = [
    { key: 'sprout', emoji: '🌱', bg: '#E6F6EC' },
    { key: 'sun', emoji: '☀️', bg: '#FFF3DC' },
    { key: 'moon', emoji: '🌙', bg: '#E9EEFF' },
    { key: 'fire', emoji: '🔥', bg: '#FFEDE6' },
    { key: 'star', emoji: '⭐', bg: '#FFF6D9' },
    { key: 'leaf', emoji: '🍀', bg: '#E6F6EC' },
];
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
// 每人最多 10 个打卡任务，前端先拦，服务端再校验一次（可被配置覆盖）。
const MAX_TASKS = 10;

// 只有自动登录失败时才出现这张卡片，正常进入小程序无需点击。
const AUTH_VIEW = {
    title: '暂时没能自动登录',
    desc: '已自动重试，请检查网络后点下方按钮，签到数据不会丢失。',
    button: '重试登录',
};

function toast(title) {
    wx.showToast({ title: title, icon: 'none', duration: 1800 });
}

function presetOf(key) {
    return AVATAR_PRESETS.filter(function (item) { return item.key === key; })[0] || AVATAR_PRESETS[0];
}

function greetingOf(hour) {
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
}

Page({
    data: {
        tab: 'checkin',
        loading: true,
        authState: 'checking',
        authView: AUTH_VIEW,
        loadingText: '正在自动登录…',
        loadingDesc: '用微信身份安全登录，无需任何操作',
        errorMsg: '',
        user: null,
        openidText: '',
        avatarEmoji: '🌱',
        avatarBg: '#E6F6EC',
        avatarPresets: AVATAR_PRESETS,
        joinDate: '',
        today: '',
        todayText: '',
        greeting: '',
        tasks: [],
        maxTasks: MAX_TASKS,
        activeTaskId: null,
        activeTask: null,
        calendarYear: 2026,
        calendarMonth: 1,
        calendarTitle: '',
        weekdays: ['一', '二', '三', '四', '五', '六', '日'],
        calendarCells: [],
        stats: { monthCount: 0, totalCount: 0, streak: 0 },
        todaySigned: false,
        recentRecords: [],
        checking: false,
        taskBusy: false,
        showTaskSheet: false,
        taskEditId: null,
        showSettingsSheet: false,
        settingsBusy: false,
        taskIcons: TASK_ICONS,
        taskColors: TASK_COLORS,
        taskDraft: { title: '', icon: TASK_ICONS[0], color: TASK_COLORS[0] },
        settingsDraft: { nickname: '', avatar: 'sprout' },
        settingsAvatarEmoji: '🌱',
        settingsAvatarBg: '#E6F6EC',
    },

    onLoad() {
        const now = new Date();
        this.setData({
            calendarYear: now.getFullYear(),
            calendarMonth: now.getMonth() + 1,
            calendarTitle: now.getFullYear() + '年' + (now.getMonth() + 1) + '月',
            today: dateUtil.today(),
            todayText: (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + WEEK_CN[now.getDay()],
            greeting: greetingOf(now.getHours()),
        });
        // App 冷启动时已经静默登录，这里直接复用结果，不重复发请求。
        const app = getApp();
        const ready = app.ready || backend.ensureLogin();
        ready.then((res) => this.restore(res)).catch(() => this.restore());
    },

    onShow() {
        // 登录失败后切后台再回来会自动重试一次，仍然不需要用户手动触发。
        if (this.data.authState === 'failed' && !this.data.loading) {
            this.restore();
        }
    },

    // prefetched：App.onLaunch 的静默登录结果；不传时重新走一遍静默登录（用于失败重试）。
    restore(prefetched) {
        const self = this;
        this.setData({
            loading: true,
            errorMsg: '',
            loadingText: prefetched ? '正在加载签到数据…' : '正在自动登录…',
            loadingDesc: prefetched ? '马上就好' : '用微信身份安全登录，无需任何操作',
        });
        const pending = prefetched ? Promise.resolve(prefetched) : backend.ensureLogin();
        return pending.then(function (res) {
            const result = res || { data: null, error: null };
            if (result.error) {
                getApp().setUser(null);
                self.setData({
                    loading: false,
                    errorMsg: result.error.message,
                    authState: 'failed',
                    authView: AUTH_VIEW,
                    user: null,
                });
                return null;
            }
            const user = result.data;
            if (!user || user.logged_in === false) {
                getApp().setUser(null);
                self.setData({ loading: false, authState: 'failed', authView: AUTH_VIEW, user: null });
                return null;
            }
            self.applyUser(user);
            self.setData({
                authState: 'signed-in',
                loadingText: '正在加载签到数据…',
                loadingDesc: '马上就好',
            });
            return self.loadAll();
        }).then(function () {
            self.setData({ loading: false });
        }).catch(function () {
            const patch = { loading: false, errorMsg: '数据加载失败，请重试' };
            if (self.data.authState !== 'signed-in') {
                patch.authState = 'failed';
                patch.authView = AUTH_VIEW;
            }
            self.setData(patch);
        });
    },

    applyUser(user) {
        const preset = presetOf(user.avatar);
        getApp().setUser(user);
        this.setData({
            user: user,
            avatarEmoji: preset.emoji,
            avatarBg: preset.bg,
            openidText: backend.maskOpenid(user),
            joinDate: String(user.created_at || '').slice(0, 10),
        });
    },

    loadAll() {
        const self = this;
        return store.tasks.list().then(function (res) {
            if (res.error) {
                self.setData({ errorMsg: res.error.message });
                return null;
            }
            const tasks = res.data || [];
            let activeId = self.data.activeTaskId;
            let active = tasks.filter(function (item) { return item.id === activeId; })[0];
            if (!active) {
                active = tasks.length ? tasks[0] : null;
                activeId = active ? active.id : null;
            }
            self.setData({ tasks: tasks, activeTaskId: activeId, activeTask: active || null });
            return self.loadCalendar();
        });
    },

    loadCalendar() {
        const self = this;
        const taskId = this.data.activeTaskId;
        const todayText = dateUtil.today();
        const prefix = dateUtil.monthPrefix(this.data.calendarYear, this.data.calendarMonth);
        if (!taskId) {
            this.setData({
                today: todayText,
                calendarCells: dateUtil.buildMonthCells(this.data.calendarYear, this.data.calendarMonth, {}, todayText),
                todaySigned: false,
                stats: { monthCount: 0, totalCount: 0, streak: 0 },
                recentRecords: [],
            });
            return Promise.resolve();
        }
        return store.checkins.list({ taskId: taskId }).then(function (res) {
            if (res.error) {
                self.setData({ errorMsg: res.error.message });
                return null;
            }
            const rows = res.data || [];
            const signedMap = {};
            rows.forEach(function (row) { signedMap[row.date] = true; });
            let monthCount = 0;
            Object.keys(signedMap).forEach(function (key) {
                if (key.indexOf(prefix) === 0) monthCount += 1;
            });
            self.setData({
                today: todayText,
                calendarCells: dateUtil.buildMonthCells(self.data.calendarYear, self.data.calendarMonth, signedMap, todayText),
                todaySigned: !!signedMap[todayText],
                stats: {
                    monthCount: monthCount,
                    totalCount: rows.length,
                    streak: dateUtil.calcStreak(signedMap, todayText),
                },
                recentRecords: rows.filter(function (row) {
                    return row.date.indexOf(prefix) === 0;
                }).slice(0, 5),
            });
            return null;
        });
    },

    switchTab(event) {
        this.setData({ tab: event.currentTarget.dataset.tab });
    },

    // 仅在自动登录失败时使用，点了依旧是静默登录，不会弹授权框。
    handleRetry() {
        this.restore();
    },

    selectTask(event) {
        // 长按会弹出操作菜单，紧接着的 tap 不应再切换任务；800ms 后自动恢复正常点击。
        if (Date.now() - (this._lastLongPressAt || 0) < 800) return;
        const id = Number(event.currentTarget.dataset.id);
        if (!id || id === this.data.activeTaskId) return;
        this.setData({ activeTaskId: id });
        this.loadAll();
    },

    openTaskSheet() {
        if (this.data.tasks.length >= MAX_TASKS) {
            toast('最多只能创建 ' + MAX_TASKS + ' 个签到任务');
            return;
        }
        this.setData({
            showTaskSheet: true,
            taskEditId: null,
            taskDraft: { title: '', icon: TASK_ICONS[0], color: TASK_COLORS[0] },
        });
    },

    // 编辑与新建复用同一个弹层：进入编辑态时预填当前任务数据。
    onEditTask(event) {
        const id = Number(event.currentTarget.dataset.id) || this.data.activeTaskId;
        this.showTaskEditor(id);
    },

    showTaskEditor(id) {
        if (!id) {
            toast('请先选择要修改的任务');
            return;
        }
        const task = this.data.tasks.filter(function (item) { return item.id === id; })[0];
        if (!task) {
            toast('任务不存在，请刷新后重试');
            return;
        }
        this.setData({
            showTaskSheet: true,
            taskEditId: id,
            taskDraft: {
                title: task.title || '',
                icon: task.icon || TASK_ICONS[0],
                color: task.color || TASK_COLORS[0],
            },
        });
    },

    closeTaskSheet() {
        this.setData({ showTaskSheet: false, taskEditId: null });
    },

    noop() {},

    onTaskTitleInput(event) {
        this.setData({ 'taskDraft.title': event.detail.value });
    },

    selectIcon(event) {
        this.setData({ 'taskDraft.icon': event.currentTarget.dataset.value });
    },

    selectColor(event) {
        this.setData({ 'taskDraft.color': event.currentTarget.dataset.value });
    },

    submitTask() {
        const draft = this.data.taskDraft;
        const title = String(draft.title || '').trim();
        if (!title) {
            toast('请输入任务名称');
            return;
        }
        if (this.data.taskBusy) return;
        const self = this;
        const editId = this.data.taskEditId;
        // 弹层打开期间可能在别的设备新建了任务，提交前再拦一次（编辑不受限制）。
        if (!editId && this.data.tasks.length >= MAX_TASKS) {
            toast('最多只能创建 ' + MAX_TASKS + ' 个签到任务');
            this.setData({ showTaskSheet: false, taskEditId: null });
            return this.loadAll();
        }
        const payload = { title: title, icon: draft.icon, color: draft.color };
        const call = editId ? store.tasks.update(editId, payload) : store.tasks.create(payload);
        this.setData({ taskBusy: true });
        return call.then(function (res) {
            self.setData({ taskBusy: false });
            if (res.error) {
                toast(res.error.message);
                // 服务端判定超限时同步最新任务列表，避免两端数据不一致。
                if (res.error.code === 'TASK_LIMIT') {
                    self.setData({ showTaskSheet: false, taskEditId: null });
                    return self.loadAll();
                }
                return null;
            }
            // 编辑时不改变当前选中的任务，新建时自动切到新任务。
            const patch = { showTaskSheet: false, taskEditId: null };
            if (!editId) patch.activeTaskId = res.data.id;
            self.setData(patch);
            wx.showToast({ title: editId ? '已保存修改' : '任务已创建', icon: 'success' });
            return self.loadAll();
        }).catch(function () {
            self.setData({ taskBusy: false });
            toast(editId ? '保存失败，请重试' : '创建失败，请重试');
        });
    },

    // 长按任务标签弹出操作菜单；删除仍需二次确认，避免误触。
    onTaskLongPress(event) {
        const dataset = event.currentTarget.dataset;
        const id = Number(dataset.id);
        if (!id) return;
        this._lastLongPressAt = Date.now();
        const title = String(dataset.title || '该任务');
        const self = this;
        wx.showActionSheet({
            itemList: ['修改任务', '删除任务'],
            success: function (res) {
                if (res.tapIndex === 0) {
                    self.showTaskEditor(id);
                    return;
                }
                if (res.tapIndex !== 1) return;
                wx.showModal({
                    title: '删除任务',
                    content: '确定删除「' + title + '」吗？该任务的签到记录也会一并清除，且无法恢复。',
                    confirmText: '删除',
                    confirmColor: '#E55353',
                    success: function (modal) {
                        if (!modal.confirm) return;
                        store.tasks.remove(id).then(function (result) {
                            if (result.error) {
                                toast(result.error.message);
                                return null;
                            }
                            self.setData({ activeTaskId: null });
                            return self.loadAll();
                        });
                    },
                });
            },
            fail: function () {},
        });
    },

    switchMonth(event) {
        const delta = Number(event.currentTarget.dataset.delta) || 0;
        const next = dateUtil.shiftMonth(this.data.calendarYear, this.data.calendarMonth, delta);
        this.setData({
            calendarYear: next.year,
            calendarMonth: next.month,
            calendarTitle: next.year + '年' + next.month + '月',
        });
        this.loadCalendar();
    },

    onCheckIn() {
        if (this.data.todaySigned || this.data.checking) return;
        if (!this.data.activeTaskId) {
            toast('请先新建一个签到任务');
            return;
        }
        const self = this;
        this.setData({ checking: true });
        store.checkins.create({
            taskId: this.data.activeTaskId,
            date: dateUtil.today(),
            time: dateUtil.formatTime(new Date()),
        }).then(function (res) {
            self.setData({ checking: false });
            if (res.error) {
                toast(res.error.message);
                return null;
            }
            wx.showToast({ title: '签到成功', icon: 'success' });
            return self.loadCalendar();
        }).catch(function () {
            self.setData({ checking: false });
            toast('签到失败，请重试');
        });
    },

    // 昵称与头像统一在「设置」弹层里修改：草稿态，点保存才一次提交，取消不写库。
    openSettings() {
        const user = this.data.user;
        const avatar = (user && user.avatar) || AVATAR_PRESETS[0].key;
        const preset = presetOf(avatar);
        this.setData({
            showSettingsSheet: true,
            settingsDraft: { nickname: user ? user.nickname : '', avatar: avatar },
            settingsAvatarEmoji: preset.emoji,
            settingsAvatarBg: preset.bg,
        });
    },

    closeSettings() {
        this.setData({ showSettingsSheet: false });
    },

    onSettingsNicknameInput(event) {
        this.setData({ 'settingsDraft.nickname': event.detail.value });
    },

    selectSettingsAvatar(event) {
        const key = event.currentTarget.dataset.key;
        const preset = presetOf(key);
        this.setData({
            'settingsDraft.avatar': key,
            settingsAvatarEmoji: preset.emoji,
            settingsAvatarBg: preset.bg,
        });
    },

    saveSettings() {
        const draft = this.data.settingsDraft;
        const nickname = String(draft.nickname || '').trim();
        if (!nickname) {
            toast('昵称不能为空');
            return;
        }
        if (this.data.settingsBusy) return;
        const self = this;
        this.setData({ settingsBusy: true });
        return store.users.upsert({ nickname: nickname.slice(0, 16), avatar: draft.avatar })
            .then(function (res) {
                self.setData({ settingsBusy: false });
                if (res.error) {
                    toast(res.error.message);
                    return null;
                }
                self.applyUser(res.data);
                self.setData({ showSettingsSheet: false });
                wx.showToast({ title: '已保存', icon: 'success' });
                return null;
            }).catch(function () {
                self.setData({ settingsBusy: false });
                toast('保存失败，请重试');
            });
    },

});
