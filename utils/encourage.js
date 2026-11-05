// 每日一句鼓励语：按「日期 + 累计积分等级」确定性选取。
// 同一天固定一句，刷新页面不会乱跳；积分跨过等级线后自动换成更进阶的话术。
// 纯前端词库，不依赖后台接口，后台没重新部署时也能正常展示。

const LEVELS = [
    { min: 0, name: '初来乍到' },
    { min: 10, name: '渐入佳境' },
    { min: 30, name: '小有坚持' },
    { min: 60, name: '习惯养成' },
    { min: 100, name: '打卡达人' },
];

const WORDS = [
    [
        '今天迈出第一步，就已经很了不起了。',
        '别急，慢慢来，每一次开始都值得记住。',
        '新的习惯从这里发芽，先为今天鼓个掌。',
        '不用做到满分，出现在这里就够了。',
        '一天一点点，日子会替你记着。',
    ],
    [
        '又见面啦，坚持的样子真好看。',
        '你正在把「想做」变成「在做」。',
        '连续几天了，节奏正在慢慢成形。',
        '今天也稳稳地完成了，继续保持。',
        '小小的重复，正在攒成大大的改变。',
    ],
    [
        '能坚持到今天，靠的是你自己。',
        '习惯开始有了重量，继续往前走。',
        '不用跟谁比，你比昨天更稳了。',
        '把平凡的一天，过成了有印记的一天。',
        '积分别急攒，日子已经在变好了。',
    ],
    [
        '这份自律，已经长进生活里了。',
        '不声不响的坚持，最有力量。',
        '你走的每一步，都算数。',
        '偶尔想偷懒也没关系，你还是来了。',
        '一件事做久了，就成了自己的底气。',
    ],
    [
        '长期主义这条路，你已经走得很远。',
        '把日子过成节奏，是很难得的本事。',
        '不必声张，成绩自己会说话。',
        '今天的你，是过去每一天攒出来的。',
        '继续吧，时间站在坚持的人这边。',
    ],
];

function hash(text) {
    let value = 0;
    for (let i = 0; i < text.length; i += 1) {
        value = (value * 31 + text.charCodeAt(i)) % 1000000007;
    }
    return value;
}

function levelIndex(points) {
    const total = Math.max(0, Number(points) || 0);
    let index = 0;
    for (let i = 0; i < LEVELS.length; i += 1) {
        if (total >= LEVELS[i].min) index = i;
    }
    return index;
}

function levelOf(points) {
    return LEVELS[levelIndex(points)].name;
}

function pick(dateText, points) {
    const group = WORDS[levelIndex(points)];
    return group[hash(String(dateText || '')) % group.length];
}

module.exports = {
    pick: pick,
    levelOf: levelOf,
    levels: LEVELS,
};
