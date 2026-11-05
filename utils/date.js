// 日期与日历计算：统一使用 YYYY-MM-DD 字符串，避免时区漂移。

function pad2(value) {
    return value < 10 ? '0' + value : '' + value;
}

function formatDate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function formatTime(date) {
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function today() {
    return formatDate(new Date());
}

function parseDate(text) {
    const parts = String(text).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

function shiftDate(text, delta) {
    const date = parseDate(text);
    date.setDate(date.getDate() + delta);
    return formatDate(date);
}

function shiftMonth(year, month, delta) {
    const date = new Date(year, month - 1 + delta, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function monthPrefix(year, month) {
    return year + '-' + pad2(month) + '-';
}

// 周一开头的月历格子，前置空格用 blank 占位。
function buildMonthCells(year, month, signedMap, todayText) {
    const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    const total = daysInMonth(year, month);
    const cells = [];
    for (let i = 0; i < offset; i += 1) {
        cells.push({ key: 'blank-' + i, blank: true });
    }
    for (let day = 1; day <= total; day += 1) {
        const date = year + '-' + pad2(month) + '-' + pad2(day);
        cells.push({
            key: date,
            blank: false,
            day: day,
            date: date,
            signed: !!signedMap[date],
            isToday: date === todayText,
            isFuture: date > todayText,
        });
    }
    return cells;
}

// 连续签到：今天没签时从昨天开始往回数。
function calcStreak(signedMap, todayText) {
    let cursor = signedMap[todayText] ? todayText : shiftDate(todayText, -1);
    let streak = 0;
    while (signedMap[cursor] && streak < 3660) {
        streak += 1;
        cursor = shiftDate(cursor, -1);
    }
    return streak;
}

module.exports = {
    formatDate: formatDate,
    formatTime: formatTime,
    today: today,
    shiftDate: shiftDate,
    shiftMonth: shiftMonth,
    monthPrefix: monthPrefix,
    buildMonthCells: buildMonthCells,
    calcStreak: calcStreak,
};
