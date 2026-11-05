// 数据层：用户信息、签到任务、签到记录全部走后台 MySQL。
// 方法签名保持 Promise<{ data, error }> 不变，页面代码无需任何改动。

const http = require('./http');

const users = {
    current() {
        return http.get('/api/user/profile');
    },

    upsert(patch) {
        return http.put('/api/user/profile', patch || {});
    },
};

const tasks = {
    list() {
        return http.get('/api/tasks');
    },

    create(payload) {
        return http.post('/api/tasks', payload || {});
    },

    update(id, patch) {
        return http.put('/api/tasks/' + id, patch || {});
    },

    remove(id) {
        return http.del('/api/tasks/' + id);
    },
};

const checkins = {
    list(query) {
        const options = query || {};
        return http.get('/api/checkins', {
            taskId: options.taskId,
            from: options.from,
            to: options.to,
        });
    },

    create(payload) {
        const data = payload || {};
        // 签到日期由服务端按 Asia/Shanghai 当天决定，前端不能伪造补签。
        return http.post('/api/checkins', { taskId: data.taskId, time: data.time });
    },
};

module.exports = { users: users, tasks: tasks, checkins: checkins };
