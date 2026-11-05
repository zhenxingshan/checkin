// 每日一句鼓励语：按「日期 + 累计积分等级」确定性选取。
// 同一天固定一句，刷新页面不会乱跳；积分跨过等级线后自动换成更进阶的话术。
// 纯前端词库，不依赖后台接口，后台没重新部署时也能正常展示。

// 10 个等级：color 用于等级名/积分数字等文字着色，tint 是配套的浅色底。
// 门槛按「每天首次签到 1~5 分」的获取速度设置，前期升级快、后期有长期目标。
const LEVELS = [
    { min: 0,   name: '初来乍到', color: '#7A8496', tint: '#F2F4F8' },
    { min: 8,   name: '渐入佳境', color: '#4C6FFF', tint: '#EEF2FF' },
    { min: 20,  name: '小有坚持', color: '#1B8AC4', tint: '#E8F5FC' },
    { min: 40,  name: '稳步向前', color: '#008E82', tint: '#E4F7F4' },
    { min: 65,  name: '习惯养成', color: '#2E8B4F', tint: '#EAF6EC' },
    { min: 100, name: '自律新星', color: '#B07D0A', tint: '#FFF6DD' },
    { min: 150, name: '打卡达人', color: '#CC5E0A', tint: '#FFF0E4' },
    { min: 220, name: '坚持不懈', color: '#D6455F', tint: '#FDECF0' },
    { min: 320, name: '习惯大师', color: '#8E44AD', tint: '#F4ECFC' },
    { min: 450, name: '长期主义', color: '#B8312A', tint: '#FBEAE7' },
];

// 每个等级一组话术，顺序与 LEVELS 一一对应，语义随等级递进。
const WORDS = [
    [
        '今天迈出第一步，就已经很了不起了。',
        '别急，慢慢来，每一次开始都值得记住。',
        '新的习惯从这里发芽，先为今天鼓个掌。',
        '不用做到满分，出现在这里就够了。',
    ],
    [
        '又见面啦，坚持的样子真好看。',
        '你正在把「想做」变成「在做」。',
        '连续几天了，节奏正在慢慢成形。',
        '小小的重复，正在攒成大大的改变。',
    ],
    [
        '能坚持到今天，靠的是你自己。',
        '不用跟谁比，你比昨天更稳了。',
        '把平凡的一天，过成了有印记的一天。',
        '积分别急攒，日子已经在变好了。',
    ],
    [
        '节奏稳下来了，继续保持就好。',
        '不慌不忙地坚持，反而走得更远。',
        '今天的完成，是昨天那个决定的回响。',
        '你已经不需要靠提醒才来了。',
    ],
    [
        '这份自律，已经长进生活里了。',
        '不声不响的坚持，最有力量。',
        '你走的每一步，都算数。',
        '一件事做久了，就成了自己的底气。',
    ],
    [
        '从「坚持一下」到「本来就该做」，你换了个境界。',
        '稳定的节奏，比一时的热血更难得。',
        '别人看到的是结果，你知道过程有多踏实。',
        '现在的你，已经能带动身边的人了。',
    ],
    [
        '长期主义这条路，你已经走得很远。',
        '把日子过成节奏，是很难得的本事。',
        '不必声张，成绩自己会说话。',
        '今天的你，是过去每一天攒出来的。',
    ],
    [
        '这么久的重复，早已不是靠意志硬撑。',
        '你已经把坚持，变成了不需要解释的日常。',
        '偶尔慢一点也没关系，方向一直没变。',
        '时间会奖励那些不急着要结果的人。',
    ],
    [
        '走到这里的人不多，而你是其中一个。',
        '习惯不再需要维护，它已经是你的一部分。',
        '这份笃定，是无数个普通日子换来的。',
        '别停下，也别忘了回头看看走了多远。',
    ],
    [
        '把一件事做成了年轮，这很了不起。',
        '时间站在你这边，因为你从没敷衍过它。',
        '最高级的天赋，是日复一日还在场。',
        '故事还长，继续写得从容一点。',
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

// 当前等级的整套主题：名称 + 文字色 + 浅色底。
function themeOf(points) {
    return LEVELS[levelIndex(points)];
}

function levelOf(points) {
    return themeOf(points).name;
}

function pick(dateText, points) {
    // 万一以后只加了等级没补词库，也不至于取到 undefined 导致页面报错。
    const group = WORDS[Math.min(levelIndex(points), WORDS.length - 1)];
    return group[hash(String(dateText || '')) % group.length];
}

module.exports = {
    pick: pick,
    levelOf: levelOf,
    themeOf: themeOf,
    levels: LEVELS,
};
