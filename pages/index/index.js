const store = require('../../utils/store');
const backend = require('../../utils/backend');
const snapshot = require('../../utils/snapshot');
const dateUtil = require('../../utils/date');
const encourage = require('../../utils/encourage');

const TASK_ICONS = [
    '🌱', '📚', '🏃', '💧', '🧘', '🎯', '☀️', '✍️',
    '🍎', '💪', '🌟', '⏰', '🎵', '💰', '🌈', '☕',
];
const TASK_COLORS = [
    '#4C6FFF', '#00B894', '#FF8A4C', '#A66CFF', '#F26D8B', '#2C9CDB',
    '#FFC53D', '#E03131', '#0CA678', '#1098AD', '#F06595', '#C28E5C',
];
const AVATAR_PRESETS = [
    { key: 'sprout', emoji: '🌸', bg: '#FFEAF3' },
    { key: 'sun', emoji: '☁️', bg: '#EEF2F7' },
    { key: 'moon', emoji: '🌙', bg: '#E9EEFF' },
    { key: 'fire', emoji: '🔥', bg: '#FFEDE6' },
    { key: 'star', emoji: '⭐', bg: '#FFF6D9' },
    { key: 'leaf', emoji: '🍀', bg: '#E6F6EC' },
    { key: 'panda', emoji: '🐼', bg: '#EEF2F7' },
    { key: 'rabbit', emoji: '🐰', bg: '#FFF0F5' },
    { key: 'fox', emoji: '🦊', bg: '#FFEFE6' },
    { key: 'bear', emoji: '🐻', bg: '#F3ECE4' },
    { key: 'chick', emoji: '🐤', bg: '#FFF8E1' },
    { key: 'fish', emoji: '🐟', bg: '#E6F7FF' },
];
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
// 每人最多 10 个打卡任务，前端先拦，服务端再校验一次（可被配置覆盖）。
const MAX_TASKS = 10;
// 字数上限：与输入框 maxlength、服务端截断长度保持一致，界面上显式展示。
const MAX_NICKNAME_LEN = 16;
const MAX_TASK_TITLE_LEN = 20;
// 长按撤销当天签到：按住 5 秒，进度每 100ms 刷新；手指明显移动即放弃，避免滑动误触。
const CANCEL_HOLD_MS = 5000;
const HOLD_TICK_MS = 100;
const HOLD_MOVE_TOLERANCE = 12;

// 只在初始化失败时出现这张卡片；文案保持中性，不向用户暴露登录细节。
const AUTH_VIEW = {
    title: '暂时没能加载',
    desc: '请检查网络后点下方按钮重试，签到数据不会丢失。',
    button: '重试',
};

// 服务端还没部署积分版本时 user.points 会缺失，用默认值兜底，页面不报错也不崩。
const DEFAULT_POINTS = {
    total: 0, today: 0, streak: 0, gained: 0,
    per_checkin: 1, next_stage_days: 3, max: 5,
    base: 1, step_days: 3, step_points: 1,
};

// 鼓励语的人员因子：由 openid 本地派生，只参与选句计算，不写日志、不上传。
// 同一个人每天换一句、当天刷新不跳变；不同人当天看到不同句子。
function seedOf(user) {
    return encourage.seed((user && user.openid) || '');
}

function normalizePoints(view) {
    const raw = view || {};
    function num(key, fallback) {
        const value = Number(raw[key]);
        return isNaN(value) ? fallback : value;
    }
    return {
        total: num('total', DEFAULT_POINTS.total),
        today: num('today', DEFAULT_POINTS.today),
        streak: num('streak', DEFAULT_POINTS.streak),
        gained: num('gained', DEFAULT_POINTS.gained),
        per_checkin: num('per_checkin', DEFAULT_POINTS.per_checkin),
        next_stage_days: num('next_stage_days', DEFAULT_POINTS.next_stage_days),
        max: num('max', DEFAULT_POINTS.max),
        base: num('base', DEFAULT_POINTS.base),
        step_days: num('step_days', DEFAULT_POINTS.step_days),
        step_points: num('step_points', DEFAULT_POINTS.step_points),
    };
}

// 等级一览：展开词库里的门槛，标出当前等级、已达成与还差多少分；每级自带专属配色。
function buildPointLevels(total) {
    const levels = encourage.levels;
    const current = encourage.levelOf(total);
    return levels.map(function (item, index) {
        const next = levels[index + 1];
        const reached = total >= item.min;
        return {
            name: item.name,
            badge: 'Lv.' + (index + 1),
            color: item.color,
            tint: item.tint,
            // 未达成的圆点保持灰色，已达成才用该等级的主色。
            dotColor: reached ? item.color : '#D9DEE8',
            range: next ? item.min + '–' + (next.min - 1) + ' 分' : item.min + ' 分起',
            reached: reached,
            current: item.name === current,
            gap: reached ? 0 : item.min - total,
        };
    });
}

// 积分档位表：按服务端下发的规则生成，改配置不用改前端。
function buildPointStages(points) {
    const base = Math.max(1, points.base);
    const stepDays = Math.max(1, points.step_days);
    const stepPoints = Math.max(0, points.step_points);
    const max = Math.max(base, points.max);
    const stages = [];
    let value = base;
    let start = 1;
    for (let i = 0; i < 10; i += 1) {
        const capped = value >= max || stepPoints === 0;
        stages.push({
            label: capped ? '第 ' + start + ' 天起' : '第 ' + start + '–' + (start + stepDays - 1) + ' 天',
            gain: Math.min(value, max),
            capped: capped,
        });
        if (capped) break;
        value += stepPoints;
        start += stepDays;
    }
    return stages;
}

function toast(title) {
    wx.showToast({ title: title, icon: 'none', duration: 1800 });
}

function presetOf(key) {
    return AVATAR_PRESETS.filter(function (item) { return item.key === key; })[0] || AVATAR_PRESETS[0];
}

Page({
    data: {
        tab: 'checkin',
        loading: true,
        // syncing 只表示后台正在校正数据：页面照常可看，仅签到按钮暂缓，避免用旧快照误操作。
        syncing: false,
        hasSnapshot: false,
        skeletonDays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35],
        authState: 'checking',
        authView: AUTH_VIEW,
        errorMsg: '',
        user: null,
        avatarEmoji: '🌸',
        avatarBg: '#FFEAF3',
        avatarPresets: AVATAR_PRESETS,
        joinDate: '',
        today: '',
        todayText: '',
        tasks: [],
        maxTasks: MAX_TASKS,
        activeTaskId: null,
        activeTask: null,
        calendarYear: 2026,
        calendarMonth: 1,
        calendarTitle: '',
        isCurrentMonth: true,
        // 长按撤销当天签到的进度态；只作用于「今天 + 已签到」的日历格子。
        holdActive: false,
        holdProgress: 0,
        holdSecondsLeft: 5,
        holdDate: '',
        cancelBusy: false,
        weekdays: ['一', '二', '三', '四', '五', '六', '日'],
        calendarCells: [],
        stats: { monthCount: 0, totalCount: 0, streak: 0 },
        // 积分是「用户 + 自然日」维度的，与上面按任务算的 stats.streak 不同。
        points: normalizePoints(null),
        // 顶部文案在骨架屏/首屏就会渲染，先给一句默认值；有快照时 renderSnapshot 会立刻按本人重算。
        encourageText: encourage.pick(dateUtil.today(), 0, seedOf(null)),
        pointLevel: encourage.levelOf(0),
        pointLevelColor: encourage.themeOf(0).color,
        pointLevelTint: encourage.themeOf(0).tint,
        todaySigned: false,
        recentRecords: [],
        checking: false,
        taskBusy: false,
        showTaskSheet: false,
        taskEditId: null,
        showSettingsSheet: false,
        settingsBusy: false,
        showPointsSheet: false,
        pointLevels: [],
        pointStages: [],
        // 拖动排序弹层：sortTasks 是临时副本，点「保存顺序」才提交，取消不影响首页。
        showSortSheet: false,
        sortTasks: [],
        sortBusy: false,
        dragIndex: -1,
        dropIndex: -1,
        sortCommitting: false,
        taskIcons: TASK_ICONS,
        taskColors: TASK_COLORS,
        taskDraft: { title: '', icon: TASK_ICONS[0], color: TASK_COLORS[0] },
        settingsDraft: { nickname: '', avatar: 'sprout' },
        maxNicknameLength: MAX_NICKNAME_LEN,
        maxTaskTitleLength: MAX_TASK_TITLE_LEN,
        nicknameCount: 0,
        taskTitleCount: 0,
        settingsAvatarEmoji: '🌱',
        settingsAvatarBg: '#E6F6EC',
    },

    onLoad() {
        const now = new Date();
        this.setData({
            calendarYear: now.getFullYear(),
            calendarMonth: now.getMonth() + 1,
            calendarTitle: now.getFullYear() + '年' + (now.getMonth() + 1) + '月',
            isCurrentMonth: true,
            today: dateUtil.today(),
            todayText: (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + WEEK_CN[now.getDay()],
        });
        // 先同步渲染本机快照，页面立刻有内容；网络只负责后台校正，不再挡住首屏。
        // 首次安装没有快照时显示同构骨架屏，也不会是一整片空白。
        const cached = snapshot.read();
        if (cached) this.renderSnapshot(cached);
        const app = getApp();
        const ready = app.ready || backend.ensureLogin();
        ready.then((res) => this.restore(res)).catch(() => this.restore());
    },

    onShow() {
        // 跨天/跨月后回到前台时，重算「回到本月」按钮的显隐。
        this.syncMonthState();
        // 失败后切后台再回来会自动重试一次，仍然不需要用户手动触发。
        if (!this.data.loading && (this.data.authState === 'failed' || this._needsRetry)) {
            this._needsRetry = false;
            this.restore();
        }
    },

    onHide() {
        this.clearCancelHold();
    },

    onUnload() {
        this.clearCancelHold();
    },

    // prefetched：App.onLaunch 的静默登录结果；不传时重新走一遍静默登录（用于失败重试）。
    restore(prefetched) {
        const self = this;
        const cached = !!this.data.hasSnapshot;
        // 有快照时不再把整页切回 loading，否则刚渲染出来的内容会闪没。
        this.setData(cached ? { syncing: true, errorMsg: '' } : { loading: true, errorMsg: '' });
        const pending = prefetched ? Promise.resolve(prefetched) : backend.ensureLogin();
        return pending.then(function (res) {
            const result = res || { data: null, error: null };
            const user = result.data;
            if (result.error || !user || user.logged_in === false) {
                // 具体错误只进控制台，界面上不出现任何「登录」字样。
                if (result.error) {
                    console.warn('[checkin] init failed:', result.error.code, result.error.message);
                }
                getApp().setUser(null);
                if (cached) {
                    // 保留已渲染的快照内容，只给一个中性的重试入口。
                    self._needsRetry = true;
                    self.setData({ syncing: false, errorMsg: '暂时没能加载，请重试' });
                } else {
                    self.setData({ loading: false, errorMsg: '', authState: 'failed', authView: AUTH_VIEW, user: null });
                }
                return null;
            }
            const oldUser = self.data.user;
            if (cached && oldUser && oldUser.openid && user.openid && oldUser.openid !== user.openid) {
                // 换了微信账号：旧快照属于上一个人，必须清掉再渲染。
                snapshot.clear();
                self.setData({
                    hasSnapshot: false,
                    tasks: [],
                    activeTaskId: null,
                    activeTask: null,
                    calendarCells: [],
                    stats: { monthCount: 0, totalCount: 0, streak: 0 },
                    points: normalizePoints(null),
                    encourageText: encourage.pick(dateUtil.today(), 0, seedOf(user)),
                    pointLevel: encourage.levelOf(0),
                    pointLevelColor: encourage.themeOf(0).color,
                    pointLevelTint: encourage.themeOf(0).tint,
                    recentRecords: [],
                    todaySigned: false,
                });
            }
            self._needsRetry = false;
            self.applyUser(user);
            self.setData({ authState: 'signed-in' });
            return self.loadAll();
        }).then(function () {
            self.setData({ loading: false, syncing: false });
        }).catch(function () {
            const patch = { loading: false, syncing: false, errorMsg: '数据加载失败，请重试' };
            if (!self.data.hasSnapshot && self.data.authState !== 'signed-in') {
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
            joinDate: String(user.created_at || '').slice(0, 10),
        });
        this.applyPointView(user && user.points);
        this.persist();
    },

    // 积分视图与当天鼓励语：用户资料、本机快照、签到响应共用这一处，显示口径一致。
    applyPointView(view) {
        const points = normalizePoints(view);
        const theme = encourage.themeOf(points.total);
        const patch = {
            points: points,
            encourageText: encourage.pick(dateUtil.today(), points.total, seedOf(this.data.user)),
            pointLevel: theme.name,
            pointLevelColor: theme.color,
            pointLevelTint: theme.tint,
        };
        if (this.data.user) {
            // 同步回用户对象，快照里存的也是最新积分，冷启动不会显示上一次的旧分。
            patch.user = Object.assign({}, this.data.user, { points: points });
            getApp().setUser(patch.user);
        }
        this.setData(patch);
        return points;
    },

    // 冷启动同步渲染：只还原原始数据，日历/统计按今天重新算，跨天不会显示过期的签到态。
    renderSnapshot(cached) {
        const tasks = cached.tasks || [];
        let activeId = cached.activeTaskId;
        let active = tasks.filter(function (item) { return item.id === activeId; })[0];
        if (!active) {
            active = tasks.length ? tasks[0] : null;
            activeId = active ? active.id : null;
        }
        this.setData({
            tasks: tasks,
            activeTaskId: activeId,
            activeTask: active || null,
        });
        this.applyRows(cached.rows || [], cached.rowsTaskId, true);
        this.applyUser(cached.user);
        this.setData({
            hasSnapshot: true,
            loading: false,
            authState: 'signed-in',
            syncing: true,
            errorMsg: '',
        });
    },

    // 从签到原始记录重算日历、统计与最近记录，并存一份快照供下次冷启动使用。
    applyRows(rows, taskId, skipPersist) {
        const list = rows || [];
        const todayText = dateUtil.today();
        const prefix = dateUtil.monthPrefix(this.data.calendarYear, this.data.calendarMonth);
        const signedMap = {};
        list.forEach(function (row) { signedMap[row.date] = true; });
        let monthCount = 0;
        Object.keys(signedMap).forEach(function (key) {
            if (key.indexOf(prefix) === 0) monthCount += 1;
        });
        this._rows = list;
        this._rowsTaskId = taskId || null;
        this.setData({
            today: todayText,
            calendarCells: dateUtil.buildMonthCells(this.data.calendarYear, this.data.calendarMonth, signedMap, todayText),
            todaySigned: !!signedMap[todayText],
            stats: {
                monthCount: monthCount,
                totalCount: list.length,
                streak: dateUtil.calcStreak(signedMap, todayText),
            },
            recentRecords: list.filter(function (row) {
                return row.date.indexOf(prefix) === 0;
            }).slice(0, 5),
        });
        if (!skipPersist) this.persist();
    },

    persist() {
        if (!this.data.user) return;
        snapshot.write({
            user: this.data.user,
            tasks: this.data.tasks || [],
            activeTaskId: this.data.activeTaskId,
            rows: this._rows || [],
            rowsTaskId: this._rowsTaskId || null,
        });
    },

    // 任务与签到记录并行请求，省掉一次串行往返；选中任务被删时才补拉一次。
    loadAll() {
        const self = this;
        const requestedId = this.data.activeTaskId;
        return Promise.all([
            store.tasks.list(),
            requestedId ? store.checkins.list({ taskId: requestedId }) : Promise.resolve({ data: [], error: null }),
        ]).then(function (list) {
            const tasksRes = list[0] || {};
            const rowsRes = list[1] || {};
            if (tasksRes.error) {
                self.setData({ errorMsg: tasksRes.error.message });
                return null;
            }
            const tasks = tasksRes.data || [];
            let activeId = self.data.activeTaskId;
            let active = tasks.filter(function (item) { return item.id === activeId; })[0];
            if (!active) {
                active = tasks.length ? tasks[0] : null;
                activeId = active ? active.id : null;
            }
            self.setData({ tasks: tasks, activeTaskId: activeId, activeTask: active || null });
            if (rowsRes.error) {
                self.setData({ errorMsg: rowsRes.error.message });
                return null;
            }
            if (activeId && activeId !== requestedId) return self.loadCalendar();
            self.applyRows(rowsRes.data || [], activeId);
            return null;
        });
    },

    loadCalendar() {
        const self = this;
        const taskId = this.data.activeTaskId;
        if (!taskId) {
            this.applyRows([], null);
            return Promise.resolve();
        }
        return store.checkins.list({ taskId: taskId }).then(function (res) {
            if (res.error) {
                self.setData({ errorMsg: res.error.message });
                return null;
            }
            self.applyRows(res.data || [], taskId);
            return null;
        });
    },

    switchTab(event) {
        this.setData({ tab: event.currentTarget.dataset.tab });
    },

    // 所有等级、当前积分与档位规则集中在这个弹层里，签到页和「我的」页都能点开。
    openPointsSheet() {
        this.setData({
            showPointsSheet: true,
            pointLevels: buildPointLevels(this.data.points.total),
            pointStages: buildPointStages(this.data.points),
        });
    },

    closePointsSheet() {
        this.setData({ showPointsSheet: false });
    },

    // 初始化失败时的兜底入口，点了依旧是静默完成，不会弹授权框。
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
            taskTitleCount: 0,
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
        const title = task.title || '';
        this.setData({
            showTaskSheet: true,
            taskEditId: id,
            taskDraft: {
                title: title,
                icon: task.icon || TASK_ICONS[0],
                color: task.color || TASK_COLORS[0],
            },
            taskTitleCount: String(title).length,
        });
    },

    closeTaskSheet() {
        this.setData({ showTaskSheet: false, taskEditId: null });
    },

    noop() {},

    onTaskTitleInput(event) {
        const value = String(event.detail.value || '');
        this.setData({ 'taskDraft.title': value, taskTitleCount: value.length });
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
        // maxlength 已挡住手输，这里再兜住历史超长数据/编辑载入，避免提交后被服务端悄悄截断。
        if (title.length > MAX_TASK_TITLE_LEN) {
            toast('任务名称最多 ' + MAX_TASK_TITLE_LEN + ' 个字');
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

    // 长按任务标签：拖动排序 + 修改 + 删除；删除仍需二次确认。
    onTaskLongPress(event) {
        const dataset = event.currentTarget.dataset;
        const id = Number(dataset.id);
        if (!id) return;
        this._lastLongPressAt = Date.now();
        const title = String(dataset.title || '该任务');
        const self = this;
        const items = [];
        const actions = [];
        if ((this.data.tasks || []).length > 1) {
            items.push('拖动排序');
            actions.push({ type: 'sort' });
        }
        items.push('修改任务');
        actions.push({ type: 'edit' });
        items.push('删除任务');
        actions.push({ type: 'remove' });
        wx.showActionSheet({
            itemList: items,
            success: function (res) {
                const action = actions[res.tapIndex];
                if (!action) return;
                if (action.type === 'sort') {
                    self.openSortSheet();
                    return;
                }
                if (action.type === 'edit') {
                    self.showTaskEditor(id);
                    return;
                }
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

    // 长按菜单里的排序入口：拿一份任务副本进弹层，取消/关闭都不会动首页顺序。
    openSortSheet() {
        const tasks = this.data.tasks || [];
        if (tasks.length < 2) {
            toast('至少两个任务才能排序');
            return;
        }
        const self = this;
        this.setData({
            showSortSheet: true,
            sortTasks: tasks.map(function (item) {
                return { id: item.id, title: item.title, icon: item.icon, color: item.color, shift: 0 };
            }),
            dragIndex: -1,
            dropIndex: -1,
            sortCommitting: false,
        }, function () {
            self.cacheSortRects();
        });
    },

    closeSortSheet() {
        if (this.data.sortBusy) return;
        this.setData({ showSortSheet: false, dragIndex: -1, dropIndex: -1, sortCommitting: false });
    },

    // 记录每行真实位置与相邻行间距（px，含间距），用作拖动时让位的步长，不写死行高。
    cacheSortRects() {
        const self = this;
        wx.createSelectorQuery().selectAll('.sort-row')
            .boundingClientRect(function (rects) {
                self._sortRects = rects || [];
                self._sortStep = rects && rects.length > 1
                    ? rects[1].top - rects[0].top
                    : (rects && rects.length ? rects[0].height : 0);
            }).exec();
    },

    // 按住手柄开始拖：记录起点、行间距，并把所有行位移清零。
    onSortTouchStart(event) {
        if (this.data.sortBusy || this.data.dragIndex >= 0) return;
        const index = Number(event.currentTarget.dataset.index);
        const touch = event.touches && event.touches[0];
        if (isNaN(index) || index < 0 || !touch) return;
        this._sortStartY = touch.clientY;
        this._sortFrom = index;
        this._sortLastDy = 0;
        this.cacheSortRects();
        const list = (this.data.sortTasks || []).map(function (t) {
            return Object.assign({}, t, { shift: 0 });
        });
        this.setData({ dragIndex: index, dropIndex: index, sortTasks: list, sortCommitting: false });
    },

    // 拖动中实时让位：被跨过的行立即上下滑动腾出空位，拖动行跟随手指，松手前不重排数组。
    // 落点直接用「位移 / 行间距」四舍五入得到，不依赖已让位的行位置，避免坐标失真。
    onSortTouchMove(event) {
        if (this.data.dragIndex < 0) return;
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        const step = this._sortStep || 0;
        const from = this._sortFrom;
        const dy = touch.clientY - this._sortStartY;
        const list = this.data.sortTasks || [];
        const n = list.length;
        if (!step) {
            // 尚未取到行高时先用拖动行跟随手指，避免卡死。
            const updated = list.map(function (t, i) {
                return Object.assign({}, t, { shift: i === from ? dy : 0 });
            });
            this._sortLastDy = dy;
            this.setData({ dropIndex: from, sortTasks: updated });
            return;
        }
        let to = from + Math.round(dy / step);
        if (to < 0) to = 0;
        if (to > n - 1) to = n - 1;
        const updated = list.map(function (t, i) {
            let shift = 0;
            if (i === from) {
                shift = dy;
            } else if (from < i && i <= to) {
                shift = -step;
            } else if (to <= i && i < from) {
                shift = step;
            }
            return Object.assign({}, t, { shift: shift });
        });
        this._sortLastDy = dy;
        this.setData({ dropIndex: to, sortTasks: updated });
    },

    // 松手分两段，避免「瞬间重排 + 清位移」导致的弹跳：
    // 第1段立即重排数组，并用「偏移」抵消布局变化带来的视觉跳动，同时关闭过渡；
    // 第2段（渲染完成后）开启过渡并把位移归零，拖动行小幅平滑落入最终位置，其他行本就在最终位不动。
    onSortTouchEnd() {
        if (this.data.dragIndex < 0) return;
        const from = this._sortFrom;
        const to = this.data.dropIndex;
        const step = this._sortStep || 0;
        const list = (this.data.sortTasks || []).slice();
        const self = this;
        if (from >= 0 && to >= 0 && from !== to && from < list.length && to < list.length) {
            const moved = list.splice(from, 1)[0];
            list.splice(to, 0, moved);
            const dy = this._sortLastDy || 0;
            // 被跨过的行在重排后新布局位恰好等于拖动中视觉位，故位移归零即可；
            // 只有拖动行需要保留「手指位移 - 整段距离」的偏移，抵消瞬间跳变。
            const offset = dy - (to - from) * step;
            const updated = list.map(function (t, j) {
                return Object.assign({}, t, { shift: (j === to) ? offset : 0 });
            });
            this.setData({ sortTasks: updated, dragIndex: -1, dropIndex: -1, sortCommitting: true });
            wx.nextTick(function () {
                const settled = (self.data.sortTasks || []).map(function (t) {
                    return Object.assign({}, t, { shift: 0 });
                });
                self.setData({ sortTasks: settled, sortCommitting: false });
            });
        } else {
            // 没有跨行：拖动行平滑弹回原位即可。
            const reset = list.map(function (t) { return Object.assign({}, t, { shift: 0 }); });
            this.setData({ sortTasks: reset, dragIndex: -1, dropIndex: -1 });
        }
        this._sortFrom = -1;
        this._sortRects = [];
    },

    // 把完整 id 顺序提交给后端整列重排，一次请求落库。
    saveSortOrder() {
        if (this.data.sortBusy) return;
        const ids = (this.data.sortTasks || []).map(function (item) { return item.id; });
        if (ids.length < 2) return;
        const self = this;
        this.setData({ sortBusy: true });
        store.tasks.reorder(ids).then(function (res) {
            self.setData({ sortBusy: false });
            if (res.error) {
                toast(res.error.message);
                return null;
            }
            const tasks = res.data || [];
            const active = tasks.filter(function (item) {
                return item.id === self.data.activeTaskId;
            })[0] || null;
            self.setData({
                tasks: tasks,
                activeTask: active,
                showSortSheet: false,
                dragIndex: -1,
                dropIndex: -1,
                sortCommitting: false,
            });
            self.persist();
            wx.showToast({ title: '顺序已保存', icon: 'success' });
            return null;
        }).catch(function () {
            self.setData({ sortBusy: false });
            toast('排序失败，请重试');
        });
    },

    switchMonth(event) {
        const delta = Number(event.currentTarget.dataset.delta) || 0;
        const next = dateUtil.shiftMonth(this.data.calendarYear, this.data.calendarMonth, delta);
        this.setData({ calendarYear: next.year, calendarMonth: next.month });
        this.syncMonthState();
        this.loadCalendar();
    },

    // 翻了很多个月后一键回到当前月份，并重新拉该月记录。
    backToCurrentMonth() {
        const now = new Date();
        this.setData({ calendarYear: now.getFullYear(), calendarMonth: now.getMonth() + 1 });
        this.syncMonthState();
        this.loadCalendar();
    },

    syncMonthState() {
        const now = new Date();
        this.setData({
            isCurrentMonth: this.data.calendarYear === now.getFullYear()
                && this.data.calendarMonth === now.getMonth() + 1,
            calendarTitle: this.data.calendarYear + '年' + this.data.calendarMonth + '月',
        });
    },

    // 长按 5 秒撤销当天签到：只有「今天且已签到」的格子会启动计时，历史日期一律不响应。
    onCalCellTouchStart(event) {
        const dataset = event.currentTarget.dataset;
        if (!dataset.today || !dataset.signed) return;
        if (this.data.syncing || this.data.checking || this.data.cancelBusy) return;
        if (!this.data.activeTaskId) return;
        this.clearCancelHold();
        const touch = event.touches && event.touches[0];
        this._holdStartPos = touch ? { x: touch.clientX, y: touch.clientY } : null;
        const self = this;
        const startAt = Date.now();
        this.setData({
            holdActive: true, holdProgress: 0,
            holdSecondsLeft: Math.ceil(CANCEL_HOLD_MS / 1000), holdDate: dataset.date,
        });
        this._holdTimer = setInterval(function () {
            const elapsed = Date.now() - startAt;
            self.setData({
                holdProgress: Math.min(100, Math.round(elapsed / CANCEL_HOLD_MS * 100)),
                holdSecondsLeft: Math.max(1, Math.ceil((CANCEL_HOLD_MS - elapsed) / 1000)),
            });
            if (elapsed < CANCEL_HOLD_MS) return;
            self.clearCancelHold();
            self.cancelTodayCheckin();
        }, HOLD_TICK_MS);
    },

    onCalCellTouchMove(event) {
        if (!this._holdTimer || !this._holdStartPos) return;
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        if (Math.abs(touch.clientX - this._holdStartPos.x) > HOLD_MOVE_TOLERANCE
            || Math.abs(touch.clientY - this._holdStartPos.y) > HOLD_MOVE_TOLERANCE) {
            this.clearCancelHold();
        }
    },

    onCalCellTouchEnd() {
        this.clearCancelHold();
    },

    clearCancelHold() {
        if (this._holdTimer) {
            clearInterval(this._holdTimer);
            this._holdTimer = null;
        }
        this._holdStartPos = null;
        if (this.data.holdActive || this.data.holdProgress) {
            this.setData({ holdActive: false, holdProgress: 0, holdDate: '' });
        }
    },

    cancelTodayCheckin() {
        if (this.data.cancelBusy || !this.data.activeTaskId) return;
        const self = this;
        this.setData({ cancelBusy: true });
        return store.checkins.cancelToday(this.data.activeTaskId).then(function (res) {
            self.setData({ cancelBusy: false });
            if (res.error) {
                toast(res.error.message);
                return null;
            }
            self.applyPointView(res.data && res.data.points);
            const back = (res.data && res.data.earned_points) || 0;
            wx.showToast({
                title: back > 0 ? '已撤销，退回 ' + back + ' 积分' : '已撤销今日签到',
                icon: 'success',
            });
            return self.loadCalendar();
        }).catch(function () {
            self.setData({ cancelBusy: false });
            toast('撤销失败，请重试');
        });
    },

    onCheckIn() {
        // syncing 期间显示的是本机快照，先等后台校正完成，避免按旧状态重复签到。
        if (this.data.todaySigned || this.data.checking || this.data.syncing) return;
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
            // 签到响应里带计分后的总览：当天第二次给别的任务签到时 gained 为 0，不加分。
            const points = self.applyPointView(res.data && res.data.points);
            wx.showToast({
                title: points.gained > 0 ? '签到成功 +' + points.gained + ' 积分' : '签到成功',
                icon: 'success',
            });
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
        const nickname = user && user.nickname ? user.nickname : '';
        this.setData({
            showSettingsSheet: true,
            settingsDraft: { nickname: nickname, avatar: avatar },
            nicknameCount: String(nickname).length,
            settingsAvatarEmoji: preset.emoji,
            settingsAvatarBg: preset.bg,
        });
    },

    closeSettings() {
        this.setData({ showSettingsSheet: false });
    },

    onSettingsNicknameInput(event) {
        const value = String(event.detail.value || '');
        this.setData({ 'settingsDraft.nickname': value, nicknameCount: value.length });
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
        if (nickname.length > MAX_NICKNAME_LEN) {
            toast('昵称最多 ' + MAX_NICKNAME_LEN + ' 个字');
            return;
        }
        if (this.data.settingsBusy) return;
        const self = this;
        this.setData({ settingsBusy: true });
        return store.users.upsert({ nickname: nickname.slice(0, MAX_NICKNAME_LEN), avatar: draft.avatar })
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
