<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import { copyText } from '@/utils/clipboard'

/**
 * Emoji 搜索 & 复制
 * - 内置精选常用 Emoji 数据（组件常量），支持中英文关键词过滤
 * - 8 个分类 Tab + 全部，点击卡片复制该 Emoji
 */

/**
 * 数据集：[emoji, 分类, 英文关键词, 中文关键词]
 * 分类：smileys 笑脸情感 / animals 动物自然 / food 食物饮料 / activity 活动运动
 *       travel 旅行地点 / objects 物品对象 / symbols 符号 / flags 旗帜
 */
const RAW = [
  // ---------- 笑脸与情感 ----------
  ['😀', 'smileys', 'grinning face, grin, happy', '咧嘴笑, 开心, 高兴'],
  ['😃', 'smileys', 'smiley, open mouth, haha', '开心, 大笑, 哈哈'],
  ['😄', 'smileys', 'smile, happy, grinning', '微笑, 开心, 满意'],
  ['😁', 'smileys', 'beam, grin, teeth', '咧嘴, 露齿笑'],
  ['😆', 'smileys', 'laugh, squint, haha', '大笑, 眯眼笑'],
  ['😅', 'smileys', 'sweat smile, embarrassed, awkward', '尴尬, 冷汗, 苦笑'],
  ['🤣', 'smileys', 'rofl, rolling, hilarious', '笑得打滚, 笑死'],
  ['😂', 'smileys', 'joy, tears, laugh, lol', '笑哭, 眼泪, 大笑'],
  ['🙂', 'smileys', 'slight smile, friendly', '微笑, 友善'],
  ['😉', 'smileys', 'wink, flirt', '眨眼, 调皮'],
  ['😊', 'smileys', 'blush, shy, warm', '脸红, 微笑, 温暖'],
  ['😇', 'smileys', 'angel, innocent, halo', '天使, 善良, 光环'],
  ['🥰', 'smileys', 'in love, hearts, adore', '恋爱, 喜爱, 心花怒放'],
  ['😍', 'smileys', 'heart eyes, love, crush', '花痴, 喜欢, 爱'],
  ['🤩', 'smileys', 'star struck, amazed, wow', '星星眼, 惊叹'],
  ['😘', 'smileys', 'kiss, blow kiss, love', '飞吻, 亲亲'],
  ['😋', 'smileys', 'yum, delicious, tasty', '好吃, 馋, 美味'],
  ['😛', 'smileys', 'tongue, playful', '吐舌, 调皮'],
  ['😜', 'smileys', 'wink tongue, goofy', '吐舌, 眨眼, 调皮'],
  ['🤪', 'smileys', 'zany, goofy, crazy', '疯狂, 鬼脸'],
  ['🤑', 'smileys', 'money mouth, rich, greedy', '贪财, 见钱眼开'],
  ['🤗', 'smileys', 'hug, embrace, thanks', '拥抱, 抱抱'],
  ['🤭', 'smileys', 'giggle, oops, cover mouth', '捂嘴, 偷笑'],
  ['🤫', 'smileys', 'shush, quiet, secret', '嘘, 安静, 保密'],
  ['🤔', 'smileys', 'thinking, hmm, consider', '思考, 想想, 疑问'],
  ['🤨', 'smileys', 'eyebrow, suspicious, skeptic', '挑眉, 怀疑'],
  ['😐', 'smileys', 'neutral, blank, meh', '面无表情, 无语'],
  ['😏', 'smileys', 'smirk, smug, sly', '得意, 坏笑'],
  ['😒', 'smileys', 'unamused, annoyed, meh', '不高兴, 无奈'],
  ['🙄', 'smileys', 'eye roll, rolling eyes, annoyed', '翻白眼, 无语'],
  ['😬', 'smileys', 'grimace, awkward, yikes', '尴尬, 咧嘴'],
  ['🤥', 'smileys', 'liar, pinocchio, lying', '撒谎, 长鼻子'],
  ['😌', 'smileys', 'relieved, content, calm', '安心, 舒心'],
  ['😔', 'smileys', 'pensive, sad, down', '沮丧, 低落'],
  ['🤤', 'smileys', 'drool, hungry, drooling', '流口水, 馋'],
  ['😴', 'smileys', 'sleeping, zzz, asleep', '睡觉, 打呼'],
  ['😷', 'smileys', 'mask, sick, illness', '口罩, 生病'],
  ['🤒', 'smileys', 'fever, thermometer, sick', '发烧, 感冒'],
  ['🤕', 'smileys', 'hurt, bandage, injured', '受伤, 绷带'],
  ['🤢', 'smileys', 'nauseated, sick, gross', '恶心, 想吐'],
  ['🤮', 'smileys', 'vomit, puke, sick', '呕吐, 吐'],
  ['🥵', 'smileys', 'hot, heat, sweating', '热, 出汗, 中暑'],
  ['🥶', 'smileys', 'cold, freezing, winter', '冷, 冻僵'],
  ['🥴', 'smileys', 'woozy, dizzy, tipsy', '晕, 迷糊, 醉'],
  ['😵', 'smileys', 'dizzy, knocked out, faint', '头晕, 晕'],
  ['🤯', 'smileys', 'mind blown, shocked, explode', '震惊, 脑子炸了'],
  ['🤠', 'smileys', 'cowboy, hat, western', '牛仔, 帽子'],
  ['🥳', 'smileys', 'party, celebrate, birthday', '庆祝, 派对, 生日'],
  ['😎', 'smileys', 'cool, sunglasses, chill', '墨镜, 酷'],
  ['🤓', 'smileys', 'nerd, geek, glasses', '书呆子, 眼镜'],
  ['🧐', 'smileys', 'monocle, inspect, curious', '单片眼镜, 审视'],
  ['🙁', 'smileys', 'frown, unhappy, sad', '不开心, 皱眉'],
  ['😮', 'smileys', 'open mouth, wow, surprise', '惊讶, 哦'],
  ['😲', 'smileys', 'astonished, shocked, amazed', '惊呆, 震惊'],
  ['🥺', 'smileys', 'pleading, beg, puppy eyes', '求你了, 可怜巴巴'],
  ['😳', 'smileys', 'flushed, embarrassed, blush', '脸红, 慌张'],
  ['😥', 'smileys', 'sad relieved, phew, sweat', '失望, 冷汗'],
  ['😢', 'smileys', 'cry, tears, sad', '哭, 流泪'],
  ['😭', 'smileys', 'sob, loudly crying, bawling', '大哭, 泪流满面'],
  ['😱', 'smileys', 'scream, fear, shock', '惊恐, 尖叫'],
  ['😞', 'smileys', 'disappointed, sad, let down', '失望'],
  ['😫', 'smileys', 'tired, exhausted, upset', '累, 疲劳'],
  ['🥱', 'smileys', 'yawn, bored, tired', '打哈欠, 困, 无聊'],
  ['😤', 'smileys', 'huff, triumph, determined', '哼, 不服气'],
  ['😡', 'smileys', 'rage, angry, mad', '暴怒, 生气'],
  ['😠', 'smileys', 'angry, mad, annoyed', '生气, 不满'],
  ['😈', 'smileys', 'devil, imp, naughty', '恶魔, 调皮, 坏笑'],
  ['💀', 'smileys', 'skull, dead, death', '骷髅, 死'],
  ['💩', 'smileys', 'poop, poo, crap', '便便, 屎'],
  ['👻', 'smileys', 'ghost, spooky, halloween', '鬼, 幽灵, 万圣节'],
  ['👽', 'smileys', 'alien, ufo, et', '外星人'],
  ['🤖', 'smileys', 'robot, bot, ai', '机器人'],
  ['🎃', 'smileys', 'halloween, pumpkin, jack o lantern', '万圣节, 南瓜灯'],

  // ---------- 动物与自然 ----------
  ['🐶', 'animals', 'dog, puppy, pet', '狗, 小狗, 宠物'],
  ['🐱', 'animals', 'cat, kitty, pet', '猫, 喵, 宠物'],
  ['🐰', 'animals', 'rabbit, bunny, hare', '兔子, 小白兔'],
  ['🦊', 'animals', 'fox, sly', '狐狸'],
  ['🐻', 'animals', 'bear', '熊'],
  ['🐼', 'animals', 'panda', '熊猫'],
  ['🐨', 'animals', 'koala', '考拉, 树袋熊'],
  ['🐯', 'animals', 'tiger', '老虎, 虎'],
  ['🦁', 'animals', 'lion, brave', '狮子, 勇敢'],
  ['🐮', 'animals', 'cow, ox, moo', '奶牛, 牛'],
  ['🐷', 'animals', 'pig, piggy', '猪, 小猪'],
  ['🐸', 'animals', 'frog, toad', '青蛙'],
  ['🐵', 'animals', 'monkey', '猴子'],
  ['🙈', 'animals', 'see no evil, cover eyes', '捂眼, 尴尬'],
  ['🐔', 'animals', 'chicken, hen', '母鸡, 鸡'],
  ['🐧', 'animals', 'penguin', '企鹅'],
  ['🐦', 'animals', 'bird', '鸟, 小鸟'],
  ['🐤', 'animals', 'chick, baby bird', '小鸡, 雏鸟'],
  ['🐴', 'animals', 'horse', '马'],
  ['🦄', 'animals', 'unicorn, fantasy, magic', '独角兽, 幻想'],
  ['🐝', 'animals', 'bee, honeybee, honey', '蜜蜂'],
  ['🐛', 'animals', 'bug, caterpillar', '毛毛虫, 虫子'],
  ['🦋', 'animals', 'butterfly', '蝴蝶'],
  ['🐌', 'animals', 'snail, slow', '蜗牛, 慢'],
  ['🐞', 'animals', 'ladybug, ladybird, luck', '瓢虫'],
  ['🕷️', 'animals', 'spider, web', '蜘蛛'],
  ['🐢', 'animals', 'turtle, tortoise, slow', '乌龟, 龟'],
  ['🐍', 'animals', 'snake, serpent', '蛇'],
  ['🦖', 'animals', 't rex, dinosaur', '恐龙, 霸王龙'],
  ['🐙', 'animals', 'octopus', '章鱼'],
  ['🦀', 'animals', 'crab, seafood', '螃蟹'],
  ['🐠', 'animals', 'tropical fish, reef', '热带鱼'],
  ['🐟', 'animals', 'fish', '鱼'],
  ['🐬', 'animals', 'dolphin', '海豚'],
  ['🐳', 'animals', 'whale', '鲸鱼'],
  ['🦈', 'animals', 'shark', '鲨鱼'],
  ['🐊', 'animals', 'crocodile, alligator', '鳄鱼'],
  ['🐘', 'animals', 'elephant', '大象'],
  ['🐪', 'animals', 'camel, desert', '骆驼'],
  ['🦒', 'animals', 'giraffe', '长颈鹿'],
  ['🐑', 'animals', 'sheep, lamb, wool', '绵羊, 羊'],
  ['🐐', 'animals', 'goat', '山羊'],
  ['🦌', 'animals', 'deer', '鹿'],
  ['🐓', 'animals', 'rooster, cock', '公鸡'],
  ['🦜', 'animals', 'parrot', '鹦鹉'],
  ['🌍', 'animals', 'earth, world, global', '地球, 世界'],
  ['🌱', 'animals', 'seedling, sprout, grow', '幼苗, 发芽, 成长'],
  ['🌲', 'animals', 'evergreen, pine, tree', '松树, 圣诞树'],
  ['🌴', 'animals', 'palm tree, tropical, vacation', '棕榈树, 椰子树, 度假'],
  ['🌾', 'animals', 'rice, wheat, harvest', '稻穗, 麦, 丰收'],
  ['🌸', 'animals', 'cherry blossom, sakura, spring', '樱花, 春天'],
  ['🌹', 'animals', 'rose, flower, love', '玫瑰'],
  ['🌻', 'animals', 'sunflower', '向日葵'],
  ['🌷', 'animals', 'tulip, flower', '郁金香'],
  ['🍀', 'animals', 'clover, lucky, fortune', '四叶草, 幸运'],
  ['🍁', 'animals', 'maple leaf, autumn, canada', '枫叶, 秋天'],
  ['🍄', 'animals', 'mushroom, fungus', '蘑菇'],
  ['🐚', 'animals', 'shell, seashell', '贝壳, 海螺'],
  ['💧', 'animals', 'droplet, water, drop', '水滴'],
  ['🌊', 'animals', 'wave, sea, ocean', '海浪, 大海'],
  ['🔥', 'animals', 'fire, flame, hot, trending', '火, 热门, 燃'],
  ['⭐', 'animals', 'star, favorite', '星星, 收藏'],
  ['🌟', 'animals', 'glowing star, shine, special', '闪亮, 特别'],
  ['✨', 'animals', 'sparkles, shiny, magic', '闪光, 亮晶晶, 魔法'],
  ['🌈', 'animals', 'rainbow, colorful', '彩虹'],
  ['☀️', 'animals', 'sun, sunny, hot', '太阳, 晴'],
  ['❄️', 'animals', 'snowflake, snow, cold, winter', '雪花, 冬天, 冷'],
  ['⛄', 'animals', 'snowman, winter', '雪人'],
  ['🌙', 'animals', 'moon, night, sleep', '月亮, 夜晚'],
  ['⚡', 'animals', 'lightning, electric, fast, power', '闪电, 电, 快'],

  // ---------- 食物与饮料 ----------
  ['🍎', 'food', 'apple, fruit', '苹果'],
  ['🍐', 'food', 'pear, fruit', '梨'],
  ['🍊', 'food', 'orange, tangerine, citrus', '橘子, 橙子'],
  ['🍋', 'food', 'lemon, citrus', '柠檬'],
  ['🍌', 'food', 'banana, fruit', '香蕉'],
  ['🍉', 'food', 'watermelon, summer', '西瓜'],
  ['🍇', 'food', 'grapes, fruit', '葡萄'],
  ['🍓', 'food', 'strawberry, fruit', '草莓'],
  ['🍒', 'food', 'cherries, fruit', '樱桃'],
  ['🍑', 'food', 'peach, fruit', '桃子'],
  ['🥭', 'food', 'mango, fruit', '芒果'],
  ['🍍', 'food', 'pineapple', '菠萝, 凤梨'],
  ['🥥', 'food', 'coconut', '椰子'],
  ['🥝', 'food', 'kiwi fruit, kiwifruit', '奇异果, 猕猴桃'],
  ['🍅', 'food', 'tomato, vegetable', '番茄, 西红柿'],
  ['🍆', 'food', 'eggplant, aubergine', '茄子'],
  ['🥑', 'food', 'avocado', '牛油果'],
  ['🥦', 'food', 'broccoli, vegetable', '西兰花'],
  ['🌽', 'food', 'corn, maize', '玉米'],
  ['🥕', 'food', 'carrot, vegetable', '胡萝卜'],
  ['🍞', 'food', 'bread, toast', '面包'],
  ['🥐', 'food', 'croissant, bread', '羊角面包, 牛角包'],
  ['🧀', 'food', 'cheese', '奶酪, 芝士'],
  ['🍗', 'food', 'poultry leg, chicken, meat', '鸡腿, 鸡肉'],
  ['🥩', 'food', 'steak, meat, beef', '牛排, 肉'],
  ['🥓', 'food', 'bacon, pork', '培根, 熏肉'],
  ['🍔', 'food', 'burger, hamburger, fast food', '汉堡'],
  ['🍟', 'food', 'fries, fast food', '薯条'],
  ['🍕', 'food', 'pizza, fast food', '披萨, 比萨'],
  ['🌭', 'food', 'hot dog, fast food', '热狗'],
  ['🥪', 'food', 'sandwich', '三明治'],
  ['🌮', 'food', 'taco, mexican', '墨西哥卷饼'],
  ['🥗', 'food', 'salad, healthy', '沙拉'],
  ['🍝', 'food', 'spaghetti, pasta', '意大利面, 意面'],
  ['🍜', 'food', 'noodles, ramen', '面条, 拉面'],
  ['🍲', 'food', 'stew, hot pot, soup', '炖菜, 火锅, 汤'],
  ['🍣', 'food', 'sushi, japanese', '寿司'],
  ['🍱', 'food', 'bento, lunch box', '便当'],
  ['🍛', 'food', 'curry rice', '咖喱饭'],
  ['🍚', 'food', 'rice, cooked rice', '米饭'],
  ['🍙', 'food', 'rice ball, onigiri', '饭团'],
  ['🥟', 'food', 'dumpling, jiaozi', '饺子'],
  ['🍦', 'food', 'ice cream, dessert', '冰淇淋'],
  ['🍩', 'food', 'donut, doughnut, dessert', '甜甜圈'],
  ['🍪', 'food', 'cookie, biscuit', '曲奇, 饼干'],
  ['🎂', 'food', 'birthday cake, cake', '生日蛋糕, 蛋糕'],
  ['🍰', 'food', 'cake, shortcake, dessert', '蛋糕, 点心'],
  ['🍫', 'food', 'chocolate, sweet', '巧克力'],
  ['🍬', 'food', 'candy, sweet', '糖果, 糖'],
  ['🍭', 'food', 'lollipop, sweet', '棒棒糖'],
  ['🍯', 'food', 'honey, sweet', '蜂蜜'],
  ['☕', 'food', 'coffee, cafe, latte', '咖啡'],
  ['🍵', 'food', 'tea, green tea, matcha', '茶, 绿茶'],
  ['🧋', 'food', 'bubble tea, boba, milk tea', '奶茶, 珍珠奶茶'],
  ['🧃', 'food', 'juice box, juice', '果汁'],
  ['🥤', 'food', 'soda, drink, cola', '饮料, 可乐'],
  ['🍺', 'food', 'beer, drink', '啤酒'],
  ['🍻', 'food', 'cheers, beers, toast', '干杯, 啤酒'],
  ['🥂', 'food', 'champagne, cheers, celebrate', '香槟, 庆祝'],
  ['🍷', 'food', 'wine, red wine', '红酒, 葡萄酒'],
  ['🍹', 'food', 'tropical drink, cocktail', '鸡尾酒, 热带饮品'],

  // ---------- 活动与运动 ----------
  ['⚽', 'activity', 'soccer, football, ball', '足球'],
  ['🏀', 'activity', 'basketball, ball, nba', '篮球'],
  ['🏈', 'activity', 'american football, ball', '橄榄球'],
  ['⚾', 'activity', 'baseball, ball', '棒球'],
  ['🥎', 'activity', 'softball, ball', '垒球'],
  ['🎾', 'activity', 'tennis, ball', '网球'],
  ['🏐', 'activity', 'volleyball, ball', '排球'],
  ['🎱', 'activity', 'pool, billiards, snooker', '台球, 桌球'],
  ['🏓', 'activity', 'ping pong, table tennis', '乒乓球'],
  ['🏸', 'activity', 'badminton, racket', '羽毛球'],
  ['🥊', 'activity', 'boxing, punch, glove', '拳击'],
  ['🥋', 'activity', 'martial arts, judo, karate', '武术, 跆拳道, 空手道'],
  ['⛳', 'activity', 'golf, flag in hole', '高尔夫'],
  ['🏆', 'activity', 'trophy, win, champion, award', '奖杯, 冠军, 获奖'],
  ['🥇', 'activity', 'gold medal, first place, win', '金牌, 第一名'],
  ['🥈', 'activity', 'silver medal, second place', '银牌, 第二名'],
  ['🥉', 'activity', 'bronze medal, third place', '铜牌, 第三名'],
  ['🎯', 'activity', 'dart, target, goal, bullseye', '正中靶心, 目标, 镖'],
  ['🎳', 'activity', 'bowling', '保龄球'],
  ['🎮', 'activity', 'game, gaming, controller', '游戏, 手柄, 电玩'],
  ['🕹️', 'activity', 'joystick, arcade, game', '摇杆, 街机'],
  ['🎲', 'activity', 'dice, random, game', '骰子, 色子, 随机'],
  ['🧩', 'activity', 'puzzle, jigsaw', '拼图'],
  ['♟️', 'activity', 'chess, pawn, strategy', '国际象棋, 棋'],
  ['🎨', 'activity', 'art, paint, palette, design', '调色板, 绘画, 设计'],
  ['🎤', 'activity', 'microphone, sing, karaoke', '麦克风, 唱歌, K歌'],
  ['🎧', 'activity', 'headphone, music, listen', '耳机, 音乐'],
  ['🎼', 'activity', 'music score, notes, sheet', '乐谱, 音符'],
  ['🎹', 'activity', 'piano, keyboard, music', '钢琴'],
  ['🥁', 'activity', 'drum, drums, rhythm', '鼓'],
  ['🎸', 'activity', 'guitar, music, rock', '吉他'],
  ['🎬', 'activity', 'movie, film, clapper', '场记板, 电影, 开拍'],
  ['🎭', 'activity', 'theater, drama, play', '戏剧, 话剧'],
  ['🎟️', 'activity', 'ticket, admission', '门票, 票'],
  ['🎿', 'activity', 'ski, skiing, snow', '滑雪'],
  ['🏊', 'activity', 'swimming, swimmer', '游泳'],

  // ---------- 旅行与地点 ----------
  ['🚗', 'travel', 'car, automobile, drive', '汽车, 车'],
  ['🚕', 'travel', 'taxi, cab', '出租车, 的士'],
  ['🚌', 'travel', 'bus, transit', '公交车, 巴士'],
  ['🏎️', 'travel', 'race car, racing, fast', '赛车'],
  ['🚓', 'travel', 'police car, police', '警车'],
  ['🚑', 'travel', 'ambulance, emergency', '救护车'],
  ['🚒', 'travel', 'fire engine, fire truck', '消防车'],
  ['🚚', 'travel', 'truck, delivery, lorry', '货车, 卡车'],
  ['🚲', 'travel', 'bicycle, bike, cycling', '自行车, 单车'],
  ['🛵', 'travel', 'motor scooter, moped', '电动车, 小型摩托车'],
  ['✈️', 'travel', 'airplane, plane, flight, travel', '飞机, 航班'],
  ['🚀', 'travel', 'rocket, launch, space', '火箭, 发射, 太空'],
  ['🛸', 'travel', 'ufo, flying saucer, alien', '飞碟, 不明飞行物'],
  ['🚁', 'travel', 'helicopter', '直升机'],
  ['🚂', 'travel', 'locomotive, train, steam', '蒸汽火车, 火车'],
  ['🚆', 'travel', 'train, railway', '火车, 列车'],
  ['🚇', 'travel', 'metro, subway, underground', '地铁'],
  ['⛵', 'travel', 'sailboat, sailing', '帆船'],
  ['🚢', 'travel', 'ship, cruise, boat', '轮船, 邮轮'],
  ['⚓', 'travel', 'anchor, ship, harbor', '锚, 港口'],
  ['🗺️', 'travel', 'world map, map, travel', '地图'],
  ['🧭', 'travel', 'compass, navigation', '指南针, 罗盘'],
  ['🗽', 'travel', 'statue of liberty, new york', '自由女神像'],
  ['🏰', 'travel', 'castle, medieval, fairy tale', '城堡'],
  ['🎡', 'travel', 'ferris wheel, amusement park', '摩天轮, 游乐园'],
  ['🎢', 'travel', 'roller coaster, amusement park', '过山车, 游乐园'],
  ['⛲', 'travel', 'fountain', '喷泉'],
  ['🏝️', 'travel', 'desert island, island, vacation', '海岛, 度假'],
  ['🏖️', 'travel', 'beach, seaside, vacation', '沙滩, 海滩'],
  ['⛰️', 'travel', 'mountain, hill', '山'],
  ['🏔️', 'travel', 'snow mountain, mountain', '雪山'],
  ['🌋', 'travel', 'volcano, eruption', '火山'],
  ['🏕️', 'travel', 'camping, tent, outdoor', '露营, 帐篷'],
  ['🏠', 'travel', 'house, home', '房子, 家'],
  ['🏢', 'travel', 'office building, office', '写字楼, 办公楼'],
  ['🏭', 'travel', 'factory, industry', '工厂'],
  ['🏥', 'travel', 'hospital, medical', '医院'],
  ['🏫', 'travel', 'school, education', '学校'],
  ['🎓', 'travel', 'graduation cap, graduate, degree', '毕业帽, 学士, 毕业'],
  ['🕌', 'travel', 'mosque, islam', '清真寺'],
  ['⛩️', 'travel', 'shinto shrine, japan', '神社'],

  // ---------- 物品与对象 ----------
  ['💡', 'objects', 'light bulb, idea, lamp', '灯泡, 想法, 点子'],
  ['🔍', 'objects', 'magnifier, search, zoom, find', '放大镜, 搜索, 查找'],
  ['🔒', 'objects', 'locked, lock, secure, password', '上锁, 安全, 密码'],
  ['🔑', 'objects', 'key, password, secret', '钥匙, 密钥'],
  ['💰', 'objects', 'money bag, money, rich', '钱袋, 钱'],
  ['💵', 'objects', 'dollar, banknote, money', '美元, 钞票'],
  ['💳', 'objects', 'credit card, payment, bank card', '信用卡, 付款'],
  ['🧾', 'objects', 'receipt, invoice, bill', '收据, 发票, 账单'],
  ['💎', 'objects', 'gem, diamond, jewel', '钻石, 宝石'],
  ['🔧', 'objects', 'wrench, tool, fix', '扳手, 修理'],
  ['🔨', 'objects', 'hammer, tool', '锤子'],
  ['⚙️', 'objects', 'gear, settings', '齿轮, 设置'],
  ['💊', 'objects', 'pill, medicine, drug', '药, 药丸'],
  ['💉', 'objects', 'syringe, injection, vaccine', '注射器, 打针, 疫苗'],
  ['🚪', 'objects', 'door', '门'],
  ['🛏️', 'objects', 'bed, sleep', '床, 睡觉'],
  ['🚿', 'objects', 'shower, bath', '淋浴'],
  ['🧹', 'objects', 'broom, clean, sweep', '扫帚, 打扫'],
  ['🗑️', 'objects', 'wastebasket, trash, delete', '垃圾桶, 删除'],
  ['📊', 'objects', 'bar chart, stats, data', '柱状图, 统计, 数据'],
  ['📈', 'objects', 'chart up, growth, rise, trend', '上涨, 上升趋势'],
  ['📉', 'objects', 'chart down, decline, fall, trend', '下跌, 下降趋势'],
  ['📅', 'objects', 'calendar, date, schedule', '日历, 日期'],
  ['📌', 'objects', 'pushpin, pin, mark', '图钉, 标记'],
  ['📎', 'objects', 'paperclip, attachment', '回形针, 附件'],
  ['✂️', 'objects', 'scissors, cut', '剪刀, 剪'],
  ['💻', 'objects', 'laptop, computer, notebook', '笔记本电脑, 电脑'],
  ['🖥️', 'objects', 'desktop, computer, monitor', '台式电脑, 显示器'],
  ['⌨️', 'objects', 'keyboard, typing', '键盘'],
  ['🖱️', 'objects', 'mouse, computer mouse', '鼠标'],
  ['🖨️', 'objects', 'printer, print', '打印机'],
  ['💾', 'objects', 'floppy, save, storage', '软盘, 保存'],
  ['🎥', 'objects', 'movie camera, film, video', '电影摄影机, 视频'],
  ['📷', 'objects', 'camera, photo, shot', '相机, 拍照'],
  ['📺', 'objects', 'tv, television, watch', '电视'],
  ['📻', 'objects', 'radio, broadcast', '收音机, 广播'],
  ['🎙️', 'objects', 'studio microphone, record, podcast', '录音麦克风, 播客'],
  ['⏰', 'objects', 'alarm clock, wake up, morning', '闹钟, 早起'],
  ['🔋', 'objects', 'battery, power, charge', '电池, 电量'],
  ['🔌', 'objects', 'plug, power, electric', '插头, 电源'],
  ['🧸', 'objects', 'teddy bear, toy, plush', '玩具熊, 泰迪熊'],
  ['🎁', 'objects', 'gift, present, surprise', '礼物, 礼品'],
  ['🎈', 'objects', 'balloon, party, celebrate', '气球'],
  ['🎉', 'objects', 'party popper, celebrate, congrats', '庆祝, 恭喜, 拉炮'],
  ['📦', 'objects', 'package, parcel, box, delivery', '包裹, 快递, 箱子'],
  ['🛒', 'objects', 'shopping cart, cart, buy', '购物车'],
  ['🛍️', 'objects', 'shopping bags, shopping, buy', '购物袋, 逛街'],
  ['🧳', 'objects', 'luggage, travel, suitcase', '行李箱, 旅行'],

  // ---------- 符号 ----------
  ['❤️', 'symbols', 'red heart, love, like', '爱, 红心, 喜欢'],
  ['🧡', 'symbols', 'orange heart, love', '橙色心'],
  ['💛', 'symbols', 'yellow heart, love', '黄色心'],
  ['💚', 'symbols', 'green heart, love', '绿色心'],
  ['💙', 'symbols', 'blue heart, love', '蓝色心'],
  ['💜', 'symbols', 'purple heart, love', '紫色心'],
  ['🖤', 'symbols', 'black heart, dark, love', '黑色心'],
  ['🤍', 'symbols', 'white heart, love', '白色心'],
  ['💔', 'symbols', 'broken heart, breakup, sad', '心碎, 分手'],
  ['💕', 'symbols', 'two hearts, love', '双心, 恋爱'],
  ['💖', 'symbols', 'sparkling heart, excited, love', '闪亮的心, 心动'],
  ['💘', 'symbols', 'heart with arrow, cupid, valentine', '丘比特, 情人节'],
  ['💯', 'symbols', 'hundred points, perfect, score, full marks', '满分, 一百分, 完美'],
  ['💢', 'symbols', 'anger symbol, frustrate, annoyed', '愤怒, 青筋'],
  ['💥', 'symbols', 'collision, boom, explode, bang', '爆炸, 撞击, 砰'],
  ['💦', 'symbols', 'sweat droplets, splash, water', '汗水, 水花'],
  ['💬', 'symbols', 'speech balloon, chat, comment, message', '对话, 聊天, 评论'],
  ['💭', 'symbols', 'thought balloon, think, idea', '想法, 心里话'],
  ['💤', 'symbols', 'zzz, sleep, snore', '睡觉, 打呼'],
  ['✅', 'symbols', 'check mark button, done, ok, complete', '完成, 通过, 打勾'],
  ['☑️', 'symbols', 'check box, checked, selected', '复选框, 已选'],
  ['✔️', 'symbols', 'check mark, correct, yes', '对勾, 正确'],
  ['❌', 'symbols', 'cross mark, wrong, no, cancel', '错误, 取消, 叉'],
  ['⭕', 'symbols', 'hollow red circle, circle, correct', '圈, 正确'],
  ['🚫', 'symbols', 'prohibited, forbidden, ban, no', '禁止, 不允许'],
  ['⚠️', 'symbols', 'warning, caution, alert', '警告, 注意'],
  ['♻️', 'symbols', 'recycle, eco, environmental', '回收, 环保, 循环'],
  ['🔴', 'symbols', 'red circle, red dot, record', '红点, 红色'],
  ['🟡', 'symbols', 'yellow circle, yellow dot', '黄色圆点'],
  ['🟢', 'symbols', 'green circle, green dot', '绿色圆点'],
  ['🔵', 'symbols', 'blue circle, blue dot', '蓝色圆点'],
  ['⚫', 'symbols', 'black circle, black dot', '黑色圆点'],
  ['⚪', 'symbols', 'white circle, white dot', '白色圆点'],
  ['♠️', 'symbols', 'spade, poker, cards', '黑桃, 扑克'],
  ['♥️', 'symbols', 'heart suit, poker, cards', '红桃, 扑克'],
  ['♦️', 'symbols', 'diamond suit, poker, cards', '方块, 扑克'],
  ['♣️', 'symbols', 'club suit, poker, cards', '梅花, 扑克'],
  ['ℹ️', 'symbols', 'information, info, about', '信息, 提示'],

  // ---------- 旗帜 ----------
  ['🏁', 'flags', 'chequered flag, finish, race, start', '终点旗, 格子旗, 赛车终点'],
  ['🚩', 'flags', 'triangular flag, red flag, mark', '红旗, 标记'],
  ['🎌', 'flags', 'crossed flags, celebration', '双旗, 庆典'],
  ['🏴', 'flags', 'black flag', '黑旗'],
  ['🏳️', 'flags', 'white flag, surrender', '白旗, 投降'],
  ['🏳️‍🌈', 'flags', 'rainbow flag, pride', '彩虹旗'],
  ['🇨🇳', 'flags', 'china, chinese, cn flag', '中国, 国旗'],
  ['🇺🇸', 'flags', 'united states, usa, america', '美国, 美国国旗'],
  ['🇬🇧', 'flags', 'united kingdom, uk, britain', '英国'],
  ['🇯🇵', 'flags', 'japan, jp flag', '日本'],
  ['🇰🇷', 'flags', 'south korea, kr flag', '韩国'],
  ['🇫🇷', 'flags', 'france, french', '法国'],
  ['🇩🇪', 'flags', 'germany, german', '德国'],
  ['🇮🇹', 'flags', 'italy, italian', '意大利'],
  ['🇪🇸', 'flags', 'spain, spanish', '西班牙'],
  ['🇷🇺', 'flags', 'russia, russian', '俄罗斯'],
  ['🇮🇳', 'flags', 'india, indian', '印度'],
  ['🇮🇩', 'flags', 'indonesia', '印度尼西亚'],
  ['🇹🇭', 'flags', 'thailand, thai', '泰国'],
  ['🇻🇳', 'flags', 'vietnam, vietnamese', '越南'],
  ['🇸🇬', 'flags', 'singapore', '新加坡'],
  ['🇦🇺', 'flags', 'australia, aussie', '澳大利亚, 澳洲'],
  ['🇨🇦', 'flags', 'canada, canadian', '加拿大'],
  ['🇲🇽', 'flags', 'mexico, mexican', '墨西哥'],
  ['🇧🇷', 'flags', 'brazil, brazilian', '巴西'],
  ['🇦🇷', 'flags', 'argentina', '阿根廷'],
  ['🇨🇭', 'flags', 'switzerland, swiss', '瑞士'],
  ['🇹🇷', 'flags', 'turkey, turkish', '土耳其'],
]

const EMOJIS = RAW.map(item => ({
  emoji: item[0],
  category: item[1],
  en: item[2].split(',').map(s => s.trim()),
  zh: item[3].split(',').map(s => s.trim()),
}))

const CATEGORIES = ['smileys', 'animals', 'food', 'activity', 'travel', 'objects', 'symbols', 'flags']
const CATEGORY_KEYS = {
  smileys: 'catSmileys',
  animals: 'catAnimals',
  food: 'catFood',
  activity: 'catActivity',
  travel: 'catTravel',
  objects: 'catObjects',
  symbols: 'catSymbols',
  flags: 'catFlags',
}

const { t } = useI18n()
const toast = useToast()

const query = ref('')
const activeCategory = ref('all')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return EMOJIS.filter(item => {
    if (activeCategory.value !== 'all' && item.category !== activeCategory.value) return false
    if (!q) return true
    return (
      item.emoji === q ||
      item.en.some(k => k.includes(q)) ||
      item.zh.some(k => k.includes(q))
    )
  })
})

function categoryLabel(cat) {
  return cat === 'all'
    ? t('toolsCommon.all')
    : t(`tools.emojiSearch.${CATEGORY_KEYS[cat]}`)
}

function cellTitle(item) {
  return `${item.zh[0]} · ${item.en[0]}`
}

async function pick(item) {
  try {
    const ok = await copyText(item.emoji)
    if (ok) {
      toast.success(t('tools.emojiSearch.copiedOne', { emoji: item.emoji }))
    } else {
      toast.error(t('toolsCommon.copyFailed'))
    }
  } catch {
    toast.error(t('toolsCommon.copyFailed'))
  }
}

function clearSearch() {
  query.value = ''
  activeCategory.value = 'all'
}
</script>

<template>
  <ToolPage tool-id="emojiSearch">
    <!-- 搜索与分类 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label for="emoji-search" class="label-base">{{ t('tools.emojiSearch.searchLabel') }}</label>
      <input
        id="emoji-search"
        v-model="query"
        type="text"
        class="input-base"
        :placeholder="t('tools.emojiSearch.searchPlaceholder')"
        autocomplete="off"
      />

      <div
        class="flex gap-2 overflow-x-auto pb-1 mt-4"
        role="tablist"
        :aria-label="t('tools.emojiSearch.gridLabel')"
      >
        <button
          v-for="cat in ['all', ...CATEGORIES]"
          :key="cat"
          type="button"
          role="tab"
          :aria-selected="activeCategory === cat"
          class="flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition select-none border"
          :class="
            activeCategory === cat
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          @click="activeCategory = cat"
        >
          {{ categoryLabel(cat) }}
        </button>
      </div>
    </section>

    <!-- 结果网格 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between mb-3">
        <span class="section-title mb-0">{{ t('tools.emojiSearch.gridLabel') }}</span>
        <span class="chip">
          {{ t('toolsCommon.total') }} {{ filtered.length }} {{ t('toolsCommon.items') }}
        </span>
      </div>

      <div v-if="filtered.length" class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
        <button
          v-for="item in filtered"
          :key="item.category + item.emoji"
          type="button"
          class="flex aspect-square items-center justify-center rounded-xl bg-white/70 border border-slate-100 text-3xl hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm active:scale-90 transition select-none"
          :title="cellTitle(item)"
          :aria-label="cellTitle(item)"
          @click="pick(item)"
        >
          {{ item.emoji }}
        </button>
      </div>

      <!-- 空状态 -->
      <div v-else class="py-12 text-center">
        <div class="text-5xl mb-3" aria-hidden="true">🔍</div>
        <p class="text-sm font-medium text-slate-600">{{ t('tools.emojiSearch.empty') }}</p>
        <p class="text-xs text-slate-400 mt-1">{{ t('tools.emojiSearch.emptyHint') }}</p>
        <button type="button" class="btn-ghost mt-4" @click="clearSearch">
          {{ t('tools.emojiSearch.clearSearch') }}
        </button>
      </div>
    </section>
  </ToolPage>
</template>
