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

function toast(title) {
    wx.showToast({ title: title, icon: 'none', duration: 1800 });
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
        errorMsg: '',
        user: null,
        openidText: '',
        wechatState: '',
        avatarEmoji: '🌱',
        avatarBg: '#E6F6EC',
        avatarPresets: AVATAR_PRESETS,
        joinDate: '',
        today: '',
        todayText: '',
        greeting: '',
        tasks: [],
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
        signingIn: false,
        taskBusy: false,
        showTaskSheet: false,
        showNicknameSheet: false,
        taskIcons: TASK_ICONS,
        taskColors: TASK_COLORS,
        taskDraft: { title: '', icon: TASK_ICONS[0], color: TASK_COLORS[0] },
        nicknameDraft: '',
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
        const app = getApp();
        const ready = app.ready || Promise.resolve(null);
        ready.then(() => this.restore()).catch(() => this.restore());
    },

    restore() {
        const self = this;
        this.setData({ loading: true, errorMsg: '' });
        return backend.restoreUser().then(function (res) {
            if (res.error) {
                self.setData({ loading: false, authState: 'signed-out', errorMsg: res.error.message });
                return null;
            }
            const user = res.data;
            if (!user || !user.logged_in) {
                self.setData({ loading: false, authState: 'signed-out', user: null });
                return null;
            }
            self.applyUser(user);
            self.setData({ authState: 'signed-in' });
            return self.loadAll();
        }).then(function () {
            self.setData({ loading: false });
        }).catch(function () {
            self.setData({ loading: false, errorMsg: '数据加载失败，请重试' });
        });
    },

    applyUser(user) {
        const preset = AVATAR_PRESETS.filter(function (item) { return item.key === user.avatar; })[0] || AVATAR_PRESETS[0];
        const desc = backend.describeOpenid(user);
        getApp().setUser(user);
        this.setData({
            user: user,
            avatarEmoji: preset.emoji,
            avatarBg: preset.bg,
            openidText: desc.text,
            wechatState: desc.wechatState,
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

    handleRetry() {
        this.restore();
    },

    onWechatLogin() {
        if (this.data.signingIn) return;
        const self = this;
        this.setData({ signingIn: true });
        backend.signInWithWechat().then(function (res) {
            self.setData({ signingIn: false });
            if (res.error) {
                toast(res.error.message);
                return null;
            }
            wx.showToast({ title: '登录成功', icon: 'success' });
            return self.restore();
        }).catch(function () {
            self.setData({ signingIn: false });
            toast('登录失败，请重试');
        });
    },

    selectTask(event) {
        const id = Number(event.currentTarget.dataset.id);
        if (!id || id === this.data.activeTaskId) return;
        this.setData({ activeTaskId: id });
        this.loadAll();
    },

    openTaskSheet() {
        this.setData({
            showTaskSheet: true,
            taskDraft: { title: '', icon: TASK_ICONS[0], color: TASK_COLORS[0] },
        });
    },

    closeTaskSheet() {
        this.setData({ showTaskSheet: false });
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
        this.setData({ taskBusy: true });
        store.tasks.create({ title: title, icon: draft.icon, color: draft.color }).then(function (res) {
            self.setData({ taskBusy: false });
            if (res.error) {
                toast(res.error.message);
                return null;
            }
            self.setData({ showTaskSheet: false, activeTaskId: res.data.id });
            wx.showToast({ title: '任务已创建', icon: 'success' });
            return self.loadAll();
        }).catch(function () {
            self.setData({ taskBusy: false });
            toast('创建失败，请重试');
        });
    },

    deleteTask(event) {
        const id = Number(event.currentTarget.dataset.id);
        const self = this;
        wx.showModal({
            title: '删除任务',
            content: '删除后该任务的签到记录也会一并清除，且无法恢复。',
            confirmText: '删除',
            confirmColor: '#E55353',
            success: function (res) {
                if (!res.confirm) return;
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

    onEditNickname() {
        this.setData({
            showNicknameSheet: true,
            nicknameDraft: this.data.user ? this.data.user.nickname : '',
        });
    },

    closeNicknameSheet() {
        this.setData({ showNicknameSheet: false });
    },

    onNicknameInput(event) {
        this.setData({ nicknameDraft: event.detail.value });
    },

    saveNickname() {
        const value = String(this.data.nicknameDraft || '').trim();
        if (!value) {
            toast('昵称不能为空');
            return;
        }
        const self = this;
        store.users.upsert({ nickname: value.slice(0, 16) }).then(function (res) {
            if (res.error) {
                toast(res.error.message);
                return null;
            }
            self.applyUser(res.data);
            self.setData({ showNicknameSheet: false });
            wx.showToast({ title: '已保存', icon: 'success' });
            return null;
        });
    },

    selectAvatar(event) {
        const key = event.currentTarget.dataset.key;
        const self = this;
        store.users.upsert({ avatar: key }).then(function (res) {
            if (res.error) {
                toast(res.error.message);
                return null;
            }
            self.applyUser(res.data);
            return null;
        });
    },

    onSignOut() {
        const self = this;
        wx.showModal({
            title: '退出登录',
            content: '签到数据已保存在服务器，重新登录后仍在。',
            success: function (res) {
                if (!res.confirm) return;
                backend.signOut().then(function () {
                    return self.restore();
                });
            },
        });
    },
});
