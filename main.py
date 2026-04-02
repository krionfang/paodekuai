import os
import json
import random
import string
import time
import asyncio
from typing import Dict, List, Optional, Set, Tuple
from datetime import datetime
from enum import Enum

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel
import pymysql

app = FastAPI(title="跑得快")

# 数据库配置 - 通过环境变量获取（可选，未配置则使用纯内存模式）
USE_DB = os.environ.get("USE_DB", "false").lower() == "true"
DB_CONFIG = {
    "host": os.environ.get("MYSQL_HOST", ""),
    "port": int(os.environ.get("MYSQL_PORT", 3306)),
    "user": os.environ.get("MYSQL_USER", ""),
    "password": os.environ.get("MYSQL_PASSWORD", ""),
    "database": os.environ.get("MYSQL_DATABASE", ""),
    "charset": "utf8mb4",
}

# 管理员密码
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "100115")

def get_db():
    if not USE_DB:
        return None
    try:
        return pymysql.connect(**DB_CONFIG)
    except Exception as e:
        print(f"数据库连接失败（使用内存模式）: {e}")
        return None

# ==================== 牌型定义 ====================
# 牌面值映射: 3最小, A最大
CARD_ORDER = {'3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7, 'J': 8, 'Q': 9, 'K': 10, 'A': 11}
CARD_VALUES = list(CARD_ORDER.keys())
SUITS = ['♠', '♥', '♣', '♦']

class CardType(str, Enum):
    SINGLE = "single"           # 单张
    PAIR = "pair"               # 对子
    TRIPLE = "triple"           # 三条(三张不带)
    TRIPLE_TWO = "triple_two"   # 三带二
    STRAIGHT = "straight"       # 顺子(>=6张)
    DOUBLE_STRAIGHT = "double_straight"  # 连对(>=2连对)
    BOMB_SOLO = "bomb_solo"     # 四带一(炸弹)
    BOMB_PURE = "bomb_pure"     # 纯炸弹(四张)
    FOUR_THREE = "four_three"   # 四带三(普通出牌)
    PLANE = "plane"             # 飞机(两个连续三条带4张)
    PASS = "pass"               # 过

def create_deck():
    """创建一副去掉大小王和4个2的牌"""
    deck = []
    for suit in SUITS:
        for value in CARD_VALUES:
            deck.append(f"{suit}{value}")
    # 48张牌
    random.shuffle(deck)
    return deck

def get_card_value(card: str) -> str:
    """从牌中提取面值，如 ♠A -> A"""
    return card[1:] if len(card) > 1 else card

def get_card_rank(card: str) -> int:
    """获取牌的排序值"""
    value = get_card_value(card)
    return CARD_ORDER.get(value, -1)

def sort_cards(cards: List[str]) -> List[str]:
    """按大小排序牌"""
    return sorted(cards, key=lambda c: (get_card_rank(c), c[0]))

def get_values_count(cards: List[str]) -> Dict[str, int]:
    """统计每个面值出现次数"""
    count = {}
    for card in cards:
        v = get_card_value(card)
        count[v] = count.get(v, 0) + 1
    return count

def identify_card_type(cards: List[str]) -> Optional[Tuple[CardType, int]]:
    """
    识别出牌类型，返回 (类型, 比较值) 或 None(不合法)
    比较值用于同类型牌的大小比较
    规则优先级：炸弹类 > 飞机 > 四带三 > 三带二 > 连对 > 顺子 > 三条 > 对子 > 单张
    """
    if not cards:
        return None
    
    n = len(cards)
    values_count = get_values_count(cards)
    unique_values = list(values_count.keys())
    counts = list(values_count.values())
    
    # 单张
    if n == 1:
        return (CardType.SINGLE, CARD_ORDER[unique_values[0]])
    
    # 对子
    if n == 2 and len(unique_values) == 1 and counts[0] == 2:
        return (CardType.PAIR, CARD_ORDER[unique_values[0]])
    
    # 三条(三张不带，不能三带一)
    if n == 3 and len(unique_values) == 1 and counts[0] == 3:
        return (CardType.TRIPLE, CARD_ORDER[unique_values[0]])
    
    # 纯炸弹 (四张相同)
    if n == 4 and len(unique_values) == 1 and counts[0] == 4:
        return (CardType.BOMB_PURE, CARD_ORDER[unique_values[0]])
    
    # 5张牌：先检查四带一(炸弹)，再检查三带二
    if n == 5:
        fours = [v for v, c in values_count.items() if c == 4]
        if len(fours) == 1:
            return (CardType.BOMB_SOLO, CARD_ORDER[fours[0]])
        # 三带二：必须是3+2的组合（不能是3+1+1，那是三带一不允许）
        threes = [v for v, c in values_count.items() if c == 3]
        if len(threes) == 1 and len(unique_values) == 2:
            # 确保带的是一对(2张相同)，即3+2
            other_count = [c for v, c in values_count.items() if c != 3]
            if other_count[0] == 2:
                return (CardType.TRIPLE_TWO, CARD_ORDER[threes[0]])
            # 也允许带两张不同的牌(用户说"可以一样可以不一样")
        if len(threes) == 1:
            # 三带二：3张相同+2张任意（可以相同也可以不同）
            return (CardType.TRIPLE_TWO, CARD_ORDER[threes[0]])
    
    # 四带三 (普通出牌) - 7张，4+3
    if n == 7:
        fours = [v for v, c in values_count.items() if c == 4]
        if len(fours) == 1:
            remaining = sum(c for v, c in values_count.items() if c != 4)
            if remaining == 3:
                return (CardType.FOUR_THREE, CARD_ORDER[fours[0]])
    
    # 顺子 (>=6张, 连续不同面值)
    if n >= 6 and all(c == 1 for c in counts):
        ranks = sorted([CARD_ORDER[v] for v in unique_values])
        if len(ranks) == n:
            is_straight = True
            for i in range(1, len(ranks)):
                if ranks[i] - ranks[i-1] != 1:
                    is_straight = False
                    break
            if is_straight:
                return (CardType.STRAIGHT, ranks[-1])
    
    # 连对 (>=4张, 成对的连续面值, 至少2连对即4张)
    if n >= 4 and n % 2 == 0 and all(c == 2 for c in counts):
        ranks = sorted([CARD_ORDER[v] for v in unique_values])
        if len(ranks) >= 2:
            is_consecutive = True
            for i in range(1, len(ranks)):
                if ranks[i] - ranks[i-1] != 1:
                    is_consecutive = False
                    break
            if is_consecutive:
                return (CardType.DOUBLE_STRAIGHT, ranks[-1])
    
    # 飞机 (两个连续三条 + 4张任意牌 = 10张)
    if n == 10:
        # 收集所有出现>=3次的面值作为三条候选
        three_candidates = [v for v, c in values_count.items() if c >= 3]
        if len(three_candidates) >= 2:
            candidate_ranks = sorted([CARD_ORDER[v] for v in three_candidates])
            # 找两个连续的三条
            for i in range(len(candidate_ranks) - 1):
                r1, r2 = candidate_ranks[i], candidate_ranks[i+1]
                if r2 - r1 == 1:
                    # 验证：用这两个值各取3张，剩余应该恰好4张
                    v1 = [v for v in unique_values if CARD_ORDER[v] == r1][0]
                    v2 = [v for v in unique_values if CARD_ORDER[v] == r2][0]
                    used = 3 + 3  # 两个三条各用3张
                    total_remaining = n - used
                    if total_remaining == 4:
                        return (CardType.PLANE, r2)
    
    # 4张牌不是纯炸弹的情况（如3+1=三带一，不允许）
    # 不匹配任何牌型
    return None

def can_beat(play_cards: List[str], last_cards: List[str], last_type: CardType, last_rank: int) -> Optional[Tuple[CardType, int]]:
    """判断当前出牌能否打过上家"""
    result = identify_card_type(play_cards)
    if result is None:
        return None
    
    play_type, play_rank = result
    
    # 炸弹可以打任何非炸弹
    if play_type in (CardType.BOMB_PURE, CardType.BOMB_SOLO):
        if last_type not in (CardType.BOMB_PURE, CardType.BOMB_SOLO):
            return result
        # 炸弹之间比较: 纯炸 > 四带一炸
        if play_type == CardType.BOMB_PURE and last_type == CardType.BOMB_SOLO:
            return result
        if play_type == CardType.BOMB_SOLO and last_type == CardType.BOMB_PURE:
            return None
        # 同类型炸弹比大小
        if play_type == last_type and play_rank > last_rank:
            return result
        return None
    
    # 如果上家是炸弹，非炸弹打不过
    if last_type in (CardType.BOMB_PURE, CardType.BOMB_SOLO):
        return None
    
    # 非炸弹必须同类型且更大
    if play_type != last_type:
        return None
    
    # 同类型, 顺子/连对张数必须相同
    if play_type in (CardType.STRAIGHT, CardType.DOUBLE_STRAIGHT):
        if len(play_cards) != len(last_cards):
            return None
    
    if play_rank > last_rank:
        return result
    
    return None


# ==================== 房间和游戏管理 ====================
class Player:
    def __init__(self, name: str, ws: WebSocket, seat: int):
        self.name = name
        self.ws = ws
        self.seat = seat
        self.cards: List[str] = []
        self.chips: int = 100
        self.ready: bool = False
        self.games_played: int = 0  # 累计场次
        self.games_won: int = 0  # 累计胜利

class GameRoom:
    def __init__(self, room_code: str, room_name: str, host_name: str, initial_chips: int):
        self.room_code = room_code
        self.room_name = room_name
        self.host_name = host_name
        self.initial_chips = initial_chips
        self.players: Dict[str, Player] = {}
        self.status = "waiting"  # waiting, playing, finished
        self.current_turn: int = 0  # 当前该谁出牌(seat index)
        self.last_play: Optional[List[str]] = None
        self.last_play_type: Optional[CardType] = None
        self.last_play_rank: int = 0
        self.last_player: Optional[str] = None
        self.pass_count: int = 0
        self.turn_order: List[str] = []  # 出牌顺序(玩家名)
        self.game_started: bool = False
        self.admins: Set[str] = set()  # 管理员玩家名集合
        self.is_solo_mode: bool = False  # 试玩模式
        self.ai_players: Set[str] = set()  # AI 玩家名集合
        self.turn_start_time: float = 0  # 当前回合开始时间戳
        self.timeout_seconds: int = 30  # 出牌超时时间（秒）
        self.waiting_start_time: float = 0  # 等待开始倒计时开始时间
        self.waiting_timeout: int = 15  # 等待开始超时时间（秒）- 房间满人后15秒自动开始
    
    def add_player(self, name: str, ws: WebSocket) -> bool:
        if len(self.players) >= 3:
            return False
        if name in self.players:
            # 重连
            self.players[name].ws = ws
            return True
        seat = len(self.players)
        player = Player(name, ws, seat)
        player.chips = self.initial_chips
        self.players[name] = player
        return True
    
    def remove_player(self, name: str):
        if name in self.players:
            del self.players[name]
            # 重新分配座位
            for i, p in enumerate(self.players.values()):
                p.seat = i
    
    def all_ready(self) -> bool:
        if len(self.players) < 3:
            return False
        return all(p.ready for p in self.players.values())
    
    def start_game(self):
        """开始游戏，发牌"""
        deck = create_deck()
        self.status = "playing"
        self.game_started = True
        self.waiting_start_time = 0  # 重置等待计时

        # 每人16张牌
        players_list = list(self.players.values())
        for i, player in enumerate(players_list):
            player.cards = sort_cards(deck[i*16:(i+1)*16])
            player.ready = False

        # 随机决定先手
        self.current_turn = random.randint(0, 2)
        self.turn_order = [p.name for p in players_list]
        self.last_play = None
        self.last_play_type = None
        self.last_play_rank = 0
        self.last_player = None
        self.pass_count = 0
        self.turn_start_time = time.time()  # 记录回合开始时间
        self.bomb_count = 0  # 本局炸弹总次数（兼容）
        self.player_bomb_counts: Dict[str, int] = {}  # 每个玩家打出的炸弹数
        self.played_players = set()  # 记录出过牌的玩家
    
    def get_current_player_name(self) -> str:
        return self.turn_order[self.current_turn]
    
    def next_turn(self):
        """切换到下一个还有牌的玩家"""
        for _ in range(3):
            self.current_turn = (self.current_turn + 1) % 3
            name = self.turn_order[self.current_turn]
            if len(self.players[name].cards) > 0:
                self.turn_start_time = time.time()  # 更新回合开始时间
                return

    def is_timeout(self) -> bool:
        """检查当前回合是否超时"""
        return time.time() - self.turn_start_time >= self.timeout_seconds

    def auto_play_for_timeout(self, player_name: str) -> Tuple[bool, str]:
        """超时自动出牌：寻找能出的最小牌"""
        player = self.players[player_name]
        if not player or len(player.cards) == 0:
            return False, "没有牌"

        # 如果是新一轮（自由出牌），出最小的单张
        if self.last_play is None or self.last_player == player_name:
            return self.play_cards(player_name, [player.cards[0]])

        # 需要压过上家，找能打的最小牌
        cards_to_play = find_beatable_cards(player.cards, self.last_play, self.last_play_type, self.last_play_rank)
        if cards_to_play:
            return self.play_cards(player_name, cards_to_play)
        else:
            return self.player_pass(player_name)
    
    def play_cards(self, player_name: str, cards: List[str]) -> Tuple[bool, str]:
        """玩家出牌"""
        if self.status != "playing":
            return False, "游戏未开始"
        
        if self.get_current_player_name() != player_name:
            return False, "还没轮到你出牌"
        
        player = self.players[player_name]
        
        # 检查玩家是否有这些牌
        hand = player.cards.copy()
        for card in cards:
            if card in hand:
                hand.remove(card)
            else:
                return False, f"你没有牌 {card}"
        
        # 如果是新一轮(上家牌被所有人pass了，或第一次出牌)
        if self.last_play is None or self.last_player == player_name:
            # 自由出牌
            result = identify_card_type(cards)
            if result is None:
                return False, "无效的牌型"
            play_type, play_rank = result
        else:
            # 需要压过上家
            result = can_beat(cards, self.last_play, self.last_play_type, self.last_play_rank)
            if result is None:
                return False, "出的牌打不过上家"
            play_type, play_rank = result
        
        # 出牌成功
        player.cards = hand
        self.last_play = cards
        self.last_play_type = play_type
        self.last_play_rank = play_rank
        self.last_player = player_name
        self.pass_count = 0
        self.played_players.add(player_name)  # 记录出过牌
        # 记录炸弹（全局 + 按玩家）
        if play_type in (CardType.BOMB_PURE, CardType.BOMB_SOLO):
            self.bomb_count += 1
            self.player_bomb_counts[player_name] = self.player_bomb_counts.get(player_name, 0) + 1
        
        # 检查是否出完了
        if len(player.cards) == 0:
            return True, "WIN"
        
        self.next_turn()
        return True, "OK"
    
    def player_pass(self, player_name: str) -> Tuple[bool, str]:
        """玩家选择不出"""
        if self.status != "playing":
            return False, "游戏未开始"
        
        if self.get_current_player_name() != player_name:
            return False, "还没轮到你"
        
        # 如果没有上家牌(新一轮)，不能pass
        if self.last_play is None or self.last_player == player_name:
            return False, "你必须出牌（新一轮）"
        
        self.pass_count += 1
        
        # 如果其他两人都pass了，新一轮
        active_others = sum(1 for name in self.turn_order 
                          if name != self.last_player and len(self.players[name].cards) > 0)
        
        if self.pass_count >= active_others:
            # 新一轮，回到上次出牌的人
            self.pass_count = 0
            # 找到last_player在turn_order中的位置
            self.current_turn = self.turn_order.index(self.last_player)
            self.last_play = None
            self.last_play_type = None
            self.last_play_rank = 0
            return True, "NEW_ROUND"
        
        self.next_turn()
        return True, "OK"
    
    def calculate_result(self, winner_name: str) -> Dict:
        """计算结果：
        基础分 = 输家剩余手牌数
        炸弹加罚：谁打了炸弹谁多扣（每个炸弹10分），赢家多得对应的总额
                  赢家打的炸弹不罚
        春天翻倍：有输家一张没出过（16张），所有输赢翻倍
        """
        result = {"winner": winner_name, "losers": []}
        
        # 检查春天：有输家一张牌都没出过
        is_spring = False
        for name, player in self.players.items():
            if name != winner_name and name not in self.played_players:
                is_spring = True
                break
        
        total_chips_won = 0
        for name, player in self.players.items():
            player.games_played += 1
            if name != winner_name:
                cards_left = len(player.cards)
                # 基础分 = 剩余手牌数
                base_loss = cards_left
                # 炸弹加罚：只罚该输家自己打出的炸弹数 × 10
                player_bombs = self.player_bomb_counts.get(name, 0)
                bomb_penalty = player_bombs * 10
                chips_lost = base_loss + bomb_penalty
                # 春天翻倍
                if is_spring:
                    chips_lost *= 2
                player.chips -= chips_lost
                if player.chips < 0:
                    player.chips = 0
                total_chips_won += chips_lost
                result["losers"].append({
                    "name": name,
                    "cards_left": cards_left,
                    "chips_lost": chips_lost,
                    "chips_remaining": player.chips,
                    "is_spring": is_spring and name not in self.played_players,
                    "bomb_penalty": bomb_penalty,
                    "player_bombs": player_bombs,
                    "games_played": player.games_played
                })
        
        self.players[winner_name].chips += total_chips_won
        self.players[winner_name].games_won += 1
        result["winner_chips"] = self.players[winner_name].chips
        result["total_won"] = total_chips_won
        result["is_spring"] = is_spring
        result["bomb_count"] = self.bomb_count
        result["player_bomb_counts"] = dict(self.player_bomb_counts)
        result["winner_games_won"] = self.players[winner_name].games_won
        result["winner_games_played"] = self.players[winner_name].games_played
        self.status = "waiting"
        self.game_started = False
        # 重置ready
        for p in self.players.values():
            p.ready = False
        return result


# 全局房间管理
rooms: Dict[str, GameRoom] = {}
ai_games: Dict[str, Dict] = {}  # AI 游戏状态管理

def generate_room_code() -> str:
    while True:
        code = ''.join(random.choices(string.digits, k=6))
        if code not in rooms:
            return code

# ==================== AI玩家逻辑 ====================
AI_NAMES = ["小明", "小红", "小刚", "小丽", "小华", "小芳"]

async def ai_play_card(room: GameRoom, ai_name: str):
    """AI 玩家自动出牌"""
    player = room.players.get(ai_name)
    if not player or len(player.cards) == 0:
        return

    try:
        print(f"[AI] {ai_name} 尝试出牌，手牌: {len(player.cards)}张")
        # 简单的 AI 策略
        cards_to_play = None

        if room.last_play is None or room.last_player == ai_name:
            # 自由出牌，用更聪明的策略
            cards_to_play = ai_find_best_play(player.cards)
            print(f"[AI] {ai_name} 自由出牌: {cards_to_play}")
        else:
            # 需要打过上家
            # 尝试找能打的牌
            cards_to_play = find_beatable_cards(player.cards, room.last_play, room.last_play_type, room.last_play_rank)
            print(f"[AI] {ai_name} 打上家: {cards_to_play}")

        if cards_to_play:
            # 出牌
            success, msg = room.play_cards(ai_name, cards_to_play)
            if msg == "WIN":
                result = room.calculate_result(ai_name)
                await broadcast_game_end(room, result)
            else:
                await broadcast_play(room, ai_name, cards_to_play)
        else:
            # 不出
            success, msg = room.player_pass(ai_name)
            if msg == "NEW_ROUND":
                await broadcast_pass(room, ai_name, new_round=True)
            else:
                await broadcast_pass(room, ai_name, new_round=False)

    except Exception as e:
        print(f"AI {ai_name} 出牌出错: {e}")

def ai_find_best_play(hand: List[str]) -> List[str]:
    """AI 自由出牌策略：优先出能减少手牌数的牌型"""
    hand_copy = hand.copy()
    values_count = get_values_count(hand_copy)

    # 策略优先级：飞机 > 四带三 > 三带二 > 连对 > 顺子 > 三条 > 对子 > 单张
    # 但要考虑手牌数量，优先出能出完更多牌的组合

    # 1. 检查是否能出完所有牌（飞机或其他组合）
    if len(hand) == 10:
        # 检查飞机（两个连续三条 + 4张）
        three_candidates = [v for v, c in values_count.items() if c >= 3]
        if len(three_candidates) >= 2:
            three_ranks = sorted([CARD_ORDER[v] for v in three_candidates])
            for i in range(len(three_ranks) - 1):
                if three_ranks[i + 1] - three_ranks[i] == 1:
                    # 能出完，找对应的牌
                    v1 = [v for v in three_candidates if CARD_ORDER[v] == three_ranks[i]][0]
                    v2 = [v for v in three_candidates if CARD_ORDER[v] == three_ranks[i+1]][0]
                    plane_cards = [card for card in hand_copy if get_card_value(card) in (v1, v2)]
                    if len(plane_cards) == 10:
                        return plane_cards

    # 2. 检查四带三（7张）
    if len(hand) >= 7:
        fours = [v for v, c in values_count.items() if c == 4]
        if fours:
            four_v = fours[0]
            four_cards = [card for card in hand_copy if get_card_value(card) == four_v][:4]
            remaining = [card for card in hand_copy if get_card_value(card) != four_v]
            if len(remaining) >= 3:
                return four_cards + remaining[:3]

    # 3. 检查三带二（5张）
    if len(hand) >= 5:
        threes = [v for v, c in values_count.items() if c >= 3]
        if threes:
            three_v = sorted(threes, key=lambda v: CARD_ORDER[v])[0]  # 最小的三条
            three_cards = [card for card in hand_copy if get_card_value(card) == three_v][:3]
            # 优先找对子
            pairs = [v for v, c in values_count.items() if c >= 2 and v != three_v]
            if pairs:
                pair_v = sorted(pairs, key=lambda v: CARD_ORDER[v])[0]  # 最小的对子
                pair_cards = [card for card in hand_copy if get_card_value(card) == pair_v][:2]
                return three_cards + pair_cards
            # 没有对子，用任意两张
            other_cards = [card for card in hand_copy if get_card_value(card) != three_v]
            if len(other_cards) >= 2:
                return three_cards + other_cards[:2]

    # 4. 检查连对（至少2连对=4张）
    pair_values = [v for v, c in values_count.items() if c >= 2]
    pair_ranks = sorted([CARD_ORDER[v] for v in pair_values])
    # 找最长的连对（但最多出6张=3连对）
    for length in [3, 2]:  # 先找3连对，再找2连对
        if len(pair_ranks) >= length:
            for i in range(len(pair_ranks) - length + 1):
                subset = pair_ranks[i:i + length]
                if subset[-1] - subset[0] == length - 1:  # 连续
                    double_straight_cards = []
                    for rank in subset:
                        v = [val for val in values_count.keys() if CARD_ORDER[val] == rank][0]
                        double_straight_cards.extend([card for card in hand_copy if get_card_value(card) == v][:2])
                    if len(double_straight_cards) == length * 2:
                        return double_straight_cards

    # 5. 检查顺子（至少6张）
    if len(hand) >= 6:
        sorted_values = sorted([CARD_ORDER[v] for v in values_count.keys() if values_count[v] >= 1])
        max_straight_len = min(len(sorted_values), 10)  # 最多出10张
        for length in range(max_straight_len, 5, -1):  # 从长到短找
            if len(sorted_values) >= length:
                for i in range(len(sorted_values) - length + 1):
                    subset = sorted_values[i:i + length]
                    if subset[-1] - subset[0] == length - 1:  # 连续
                        straight_cards = []
                        for rank in subset:
                            v = [val for val in values_count.keys() if CARD_ORDER[val] == rank][0]
                            straight_cards.append([card for card in hand_copy if get_card_value(card) == v][0])
                        if len(straight_cards) == length:
                            return straight_cards

    # 6. 三条（3张）
    threes = [v for v, c in values_count.items() if c >= 3]
    if threes:
        three_v = sorted(threes, key=lambda v: CARD_ORDER[v])[0]
        return [card for card in hand_copy if get_card_value(card) == three_v][:3]

    # 7. 对子（2张）
    pairs = [v for v, c in values_count.items() if c >= 2]
    if pairs:
        pair_v = sorted(pairs, key=lambda v: CARD_ORDER[v])[0]
        return [card for card in hand_copy if get_card_value(card) == pair_v][:2]

    # 8. 单张（1张）
    return [hand_copy[0]]

def find_beatable_cards(hand: List[str], last_play: List[str], last_type: CardType, last_rank: int) -> Optional[List[str]]:
    """寻找能打过上家的牌"""
    # 尝试打同类型更大的牌
    n = len(last_play)
    hand_copy = hand.copy()

    # 按面值分组
    values_count = get_values_count(hand_copy)

    # 单张
    if last_type == CardType.SINGLE:
        for card in hand_copy:
            card_rank = get_card_rank(card)
            if card_rank > last_rank:
                return [card]

    # 对子
    elif last_type == CardType.PAIR:
        for v, c in values_count.items():
            if c >= 2 and CARD_ORDER[v] > last_rank:
                return [card for card in hand_copy if get_card_value(card) == v][:2]

    # 三条
    elif last_type == CardType.TRIPLE:
        for v, c in values_count.items():
            if c >= 3 and CARD_ORDER[v] > last_rank:
                return [card for card in hand_copy if get_card_value(card) == v][:3]

    # 顺子 (>=6张, 连续不同面值)
    elif last_type == CardType.STRAIGHT:
        # 收集所有连续的顺子组合
        sorted_values = sorted([CARD_ORDER[v] for v in values_count.keys() if values_count[v] >= 1])
        # 找长度匹配的顺子
        required_len = len(last_play)
        if len(sorted_values) >= required_len:
            for i in range(len(sorted_values) - required_len + 1):
                subset = sorted_values[i:i + required_len]
                if subset[-1] - subset[0] == required_len - 1:  # 连续
                    # 返回这个顺子的牌
                    straight_cards = []
                    for rank in subset:
                        v = [val for val in values_count.keys() if CARD_ORDER[val] == rank][0]
                        straight_cards.append([card for card in hand_copy if get_card_value(card) == v][0])
                    if len(straight_cards) == required_len and CARD_ORDER[get_card_value(straight_cards[-1])] > last_rank:
                        return straight_cards

    # 连对 (>=2连对, 成对的连续面值)
    elif last_type == CardType.DOUBLE_STRAIGHT:
        # 收集所有有对子(>=2张)的面值
        pair_values = [v for v, c in values_count.items() if c >= 2]
        pair_ranks = sorted([CARD_ORDER[v] for v in pair_values])
        required_len = len(last_play) // 2  # 需要多少连对
        if len(pair_ranks) >= required_len:
            for i in range(len(pair_ranks) - required_len + 1):
                subset = pair_ranks[i:i + required_len]
                if subset[-1] - subset[0] == required_len - 1:  # 连续
                    # 检查这个连对是否大于上家
                    if subset[-1] > last_rank:
                        # 返回这个连对的牌
                        double_straight_cards = []
                        for rank in subset:
                            v = [val for val in values_count.keys() if CARD_ORDER[val] == rank][0]
                            double_straight_cards.extend([card for card in hand_copy if get_card_value(card) == v][:2])
                        if len(double_straight_cards) == required_len * 2:
                            return double_straight_cards

    # 三带二
    elif last_type == CardType.TRIPLE_TWO:
        for three_v, three_c in values_count.items():
            if three_c >= 3 and CARD_ORDER[three_v] > last_rank:
                three_cards = [card for card in hand_copy if get_card_value(card) == three_v][:3]
                # 优先找两张配对的（3+2）
                for two_v, two_c in values_count.items():
                    if two_v != three_v and two_c >= 2:
                        two_cards = [card for card in hand_copy if get_card_value(card) == two_v][:2]
                        if len(three_cards) + len(two_cards) == 5:
                            return three_cards + two_cards
                # 如果没有对子，找任意两张不同的牌（3+1+1）
                remaining_cards = [card for card in hand_copy if get_card_value(card) != three_v]
                if len(remaining_cards) >= 2:
                    return three_cards + remaining_cards[:2]

    # 炸弹 (可以打任何非炸弹)
    if last_type not in (CardType.BOMB_PURE, CardType.BOMB_SOLO):
        for v, c in values_count.items():
            if c >= 4:
                return [card for card in hand_copy if get_card_value(card) == v][:4]

    return None

# ==================== API接口 ====================
class CreateRoomRequest(BaseModel):
    room_name: str
    host_name: str
    initial_chips: int = 100

class JoinRoomRequest(BaseModel):
    room_code: str
    player_name: str

class AdminLoginRequest(BaseModel):
    password: str

@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")

@app.post("/api/create_room")
async def create_room(req: CreateRoomRequest):
    if req.initial_chips not in [100, 200]:
        raise HTTPException(status_code=400, detail="初始筹码只能是100或200")
    
    room_code = generate_room_code()
    room = GameRoom(room_code, req.room_name, req.host_name, req.initial_chips)
    rooms[room_code] = room
    
    # 存入数据库（可选）
    if USE_DB:
        try:
            conn = get_db()
            if conn:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO rooms (room_code, room_name, host_name, initial_chips) VALUES (%s, %s, %s, %s)",
                    (room_code, req.room_name, req.host_name, req.initial_chips)
                )
                conn.commit()
                conn.close()
        except Exception as e:
            print(f"DB error: {e}")
    
    return {"code": 0, "data": {"room_code": room_code}}

@app.post("/api/join_room")
async def join_room(req: JoinRoomRequest):
    room = rooms.get(req.room_code)
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")
    if len(room.players) >= 3 and req.player_name not in room.players:
        raise HTTPException(status_code=400, detail="房间已满")
    if room.status == "playing" and req.player_name not in room.players:
        raise HTTPException(status_code=400, detail="游戏进行中，无法加入")
    return {"code": 0, "data": {"room_code": req.room_code, "room_name": room.room_name}}

@app.post("/api/admin_login")
async def admin_login(req: AdminLoginRequest):
    """管理员密码验证"""
    if req.password == ADMIN_PASSWORD:
        return {"code": 0, "msg": "验证成功"}
    else:
        raise HTTPException(status_code=403, detail="密码错误")

@app.post("/api/start_solo")
async def start_solo():
    """开始单人试玩模式"""
    # 生成一个随机房间号用作试玩房间
    room_code = generate_room_code()
    room = GameRoom(room_code, "试玩模式", "玩家", 100)
    room.is_solo_mode = True  # 标记为试玩模式
    rooms[room_code] = room

    return {"code": 0, "data": {"room_code": room_code, "room_name": "试玩模式"}}

@app.get("/api/room_info/{room_code}")
async def get_room_info(room_code: str):
    room = rooms.get(room_code)
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")
    players_info = []
    for name, p in room.players.items():
        players_info.append({
            "name": name,
            "seat": p.seat,
            "chips": p.chips,
            "ready": p.ready,
            "cards_count": len(p.cards),
            "is_host": name == room.host_name
        })
    return {
        "code": 0,
        "data": {
            "room_code": room_code,
            "room_name": room.room_name,
            "host_name": room.host_name,
            "initial_chips": room.initial_chips,
            "status": room.status,
            "players": players_info
        }
    }


# ==================== WebSocket ====================
@app.websocket("/ws/{room_code}/{player_name}")
async def websocket_endpoint(websocket: WebSocket, room_code: str, player_name: str):
    room = rooms.get(room_code)
    if not room:
        await websocket.close(code=4000, reason="房间不存在")
        return
    
    await websocket.accept()
    
    if not room.add_player(player_name, websocket):
        await websocket.send_json({"type": "error", "msg": "房间已满"})
        await websocket.close()
        return
    
    # 更新数据库（可选）
    if USE_DB:
        try:
            conn = get_db()
            if conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE rooms SET current_players=%s WHERE room_code=%s",
                               (len(room.players), room_code))
                conn.commit()
                conn.close()
        except Exception as e:
            print(f"DB error: {e}")
    
    # 广播玩家加入
    await broadcast_room_state(room)

    # 试玩模式：自动添加2个 AI 玩家并自动开始游戏
    if room.is_solo_mode and len(room.players) == 1:
        random.shuffle(AI_NAMES)
        for i in range(2):
            ai_name = AI_NAMES[i]
            ai_player = Player(ai_name, None, len(room.players))
            ai_player.chips = room.initial_chips
            ai_player.ready = True  # AI 自动准备
            room.players[ai_name] = ai_player
            room.ai_players.add(ai_name)
        # 真人玩家也自动准备
        room.players[player_name].ready = True
        await broadcast_room_state(room)
        # 所有人都准备好了，直接开始游戏
        if room.all_ready():
            room.start_game()
            await broadcast_game_start(room)

    # 超时检查任务
    async def timeout_checker():
        """超时检查循环"""
        while True:
            await asyncio.sleep(1)  # 每秒检查一次
            if room.status == "playing" and room.is_timeout():
                current = room.get_current_player_name()
                # AI玩家不需要超时检查，由ai_game_loop处理
                # 只处理真人玩家超时
                if current not in room.ai_players:
                    # 真人玩家超时，自动出最小能出的牌
                    success, msg = room.auto_play_for_timeout(current)
                    if msg == "WIN":
                        result = room.calculate_result(current)
                        await broadcast_game_end(room, result)
                    elif success:
                        await broadcast_play(room, current, room.last_play)
            elif room.status == "waiting" and len(room.players) == 3 and not room.is_solo_mode:
                # 房间满人且等待中，检查是否超时自动开始
                if room.waiting_start_time == 0:
                    room.waiting_start_time = time.time()
                elif time.time() - room.waiting_start_time >= room.waiting_timeout:
                    # 15秒后自动开始，所有玩家自动准备
                    for p in room.players.values():
                        p.ready = True
                    await broadcast_room_state(room)
                    if room.all_ready():
                        room.start_game()
                        await broadcast_game_start(room)

    # AI 出牌任务 - 试玩模式专用
    async def ai_game_loop():
        """AI 出牌循环，只在试玩模式下使用"""
        while room.status == "playing" and room.is_solo_mode:
            current = room.get_current_player_name()
            if current in room.ai_players:
                # AI立即出牌
                await ai_play_card(room, current)
                # 极短延迟让前端渲染
                await asyncio.sleep(0.1)
            else:
                # 不是AI回合，快速检查
                await asyncio.sleep(0.01)

    # 启动超时检查（所有模式）
    timeout_task = asyncio.create_task(timeout_checker())

    # 启动 AI 循环任务
    ai_task = None

    try:
        ai_task = asyncio.create_task(ai_game_loop())

        while True:
            # 使用receive_timeout来定期检查超时
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            action = data.get("action")

            if action == "ready":
                room.players[player_name].ready = True
                await broadcast_room_state(room)

                # 检查是否所有人都准备好了
                if room.all_ready():
                    room.start_game()
                    await broadcast_game_start(room)
            
            elif action == "cancel_ready":
                room.players[player_name].ready = False
                await broadcast_room_state(room)
            
            elif action == "play":
                cards = data.get("cards", [])
                if not cards:
                    await websocket.send_json({"type": "error", "msg": "请选择要出的牌"})
                    continue
                
                success, msg = room.play_cards(player_name, cards)
                if not success:
                    await websocket.send_json({"type": "error", "msg": msg})
                elif msg == "WIN":
                    result = room.calculate_result(player_name)
                    # 存入数据库（可选）
                    if USE_DB:
                        try:
                            conn = get_db()
                            if conn:
                                cursor = conn.cursor()
                                losers = result["losers"]
                                cursor.execute(
                                    "INSERT INTO game_records (room_id, winner_name, loser1_name, loser1_cards_left, loser1_chips_lost, loser2_name, loser2_cards_left, loser2_chips_lost) "
                                    "SELECT id, %s, %s, %s, %s, %s, %s, %s FROM rooms WHERE room_code=%s",
                                    (player_name, 
                                     losers[0]["name"], losers[0]["cards_left"], losers[0]["chips_lost"],
                                     losers[1]["name"], losers[1]["cards_left"], losers[1]["chips_lost"],
                                     room_code)
                                )
                                conn.commit()
                                conn.close()
                        except Exception as e:
                            print(f"DB error: {e}")
                    
                    await broadcast_game_end(room, result)
                else:
                    await broadcast_play(room, player_name, cards)
            
            elif action == "pass":
                success, msg = room.player_pass(player_name)
                if not success:
                    await websocket.send_json({"type": "error", "msg": msg})
                elif msg == "NEW_ROUND":
                    await broadcast_pass(room, player_name, new_round=True)
                else:
                    await broadcast_pass(room, player_name, new_round=False)
            
            elif action == "chat":
                msg_text = data.get("msg", "")
                await broadcast_chat(room, player_name, msg_text)
            
            elif action == "admin_login":
                # 管理员登录验证
                pwd = data.get("password", "")
                if pwd == ADMIN_PASSWORD:
                    room.admins.add(player_name)
                    await websocket.send_json({"type": "admin_login_result", "success": True, "msg": "🔑 管理员验证成功"})
                    await broadcast_chat(room, "系统", f"🛡️ {player_name} 已成为管理员")
                else:
                    await websocket.send_json({"type": "admin_login_result", "success": False, "msg": "密码错误"})
            
            elif action == "admin_kick":
                # 管理员踢人
                if player_name not in room.admins:
                    await websocket.send_json({"type": "error", "msg": "你不是管理员"})
                    continue
                target = data.get("target", "")
                if target == player_name:
                    await websocket.send_json({"type": "error", "msg": "不能踢自己"})
                    continue
                if target not in room.players:
                    await websocket.send_json({"type": "error", "msg": "该玩家不在房间中"})
                    continue
                if room.status == "playing":
                    await websocket.send_json({"type": "error", "msg": "游戏进行中无法踢人"})
                    continue
                # 通知被踢玩家
                kicked_ws = room.players[target].ws
                if kicked_ws:
                    await safe_send(kicked_ws, {"type": "kicked", "msg": f"你已被管理员 {player_name} 踢出房间"})
                    try:
                        await kicked_ws.close()
                    except:
                        pass
                room.remove_player(target)
                room.admins.discard(target)
                await broadcast_chat(room, "系统", f"🚫 {target} 已被管理员踢出房间")
                await broadcast_room_state(room)
            
            elif action == "admin_add_chips":
                # 管理员修改筹码
                if player_name not in room.admins:
                    await websocket.send_json({"type": "error", "msg": "你不是管理员"})
                    continue
                target = data.get("target", "")
                amount = data.get("amount", 0)
                if target not in room.players:
                    await websocket.send_json({"type": "error", "msg": "该玩家不在房间中"})
                    continue
                try:
                    amount = int(amount)
                except:
                    await websocket.send_json({"type": "error", "msg": "金额无效"})
                    continue
                room.players[target].chips += amount
                if room.players[target].chips < 0:
                    room.players[target].chips = 0
                sign = "+" if amount >= 0 else ""
                await broadcast_chat(room, "系统", f"💰 管理员调整了 {target} 的筹码 ({sign}{amount})，当前: {room.players[target].chips}")
                await broadcast_room_state(room)
            
            elif action == "admin_force_ready":
                # 管理员强制全员准备
                if player_name not in room.admins:
                    await websocket.send_json({"type": "error", "msg": "你不是管理员"})
                    continue
                if room.status == "playing":
                    await websocket.send_json({"type": "error", "msg": "游戏已在进行中"})
                    continue
                if len(room.players) < 3:
                    await websocket.send_json({"type": "error", "msg": "人数不足3人"})
                    continue
                for p in room.players.values():
                    p.ready = True
                await broadcast_chat(room, "系统", f"⚡ 管理员强制全员准备")
                await broadcast_room_state(room)
                if room.all_ready():
                    room.start_game()
                    await broadcast_game_start(room)
    
    except WebSocketDisconnect:
        if ai_task:
            ai_task.cancel()

        if room.status == "waiting" and not room.is_solo_mode:
            room.remove_player(player_name)
            if USE_DB:
                try:
                    conn = get_db()
                    if conn:
                        cursor = conn.cursor()
                        cursor.execute("UPDATE rooms SET current_players=%s WHERE room_code=%s",
                                       (len(room.players), room_code))
                        conn.commit()
                        conn.close()
                except Exception as e:
                    print(f"DB error: {e}")
            
            if len(room.players) == 0:
                del rooms[room_code]
            else:
                await broadcast_room_state(room)
        else:
            # 游戏中断线标记
            if player_name in room.players:
                room.players[player_name].ws = None
                await broadcast_room_state(room)


async def safe_send(ws: Optional[WebSocket], data: dict):
    if ws:
        try:
            await ws.send_json(data)
        except:
            pass

async def broadcast_room_state(room: GameRoom):
    players_info = []
    for name, p in room.players.items():
        players_info.append({
            "name": name,
            "seat": p.seat,
            "chips": p.chips,
            "ready": p.ready,
            "cards_count": len(p.cards),
            "is_host": name == room.host_name,
            "connected": p.ws is not None,
            "is_admin": name in room.admins,
            "games_played": p.games_played,
            "games_won": p.games_won
        })
    msg = {
        "type": "room_state",
        "data": {
            "status": room.status,
            "players": players_info,
            "room_code": room.room_code,
            "room_name": room.room_name,
            "admins": list(room.admins)
        }
    }
    for p in room.players.values():
        await safe_send(p.ws, msg)

async def broadcast_game_start(room: GameRoom):
    for name, p in room.players.items():
        msg = {
            "type": "game_start",
            "data": {
                "your_cards": p.cards,
                "current_turn": room.get_current_player_name(),
                "players": [{
                    "name": n,
                    "seat": pl.seat,
                    "chips": pl.chips,
                    "cards_count": len(pl.cards)
                } for n, pl in room.players.items()]
            }
        }
        await safe_send(p.ws, msg)

async def broadcast_play(room: GameRoom, player_name: str, cards: List[str]):
    for name, p in room.players.items():
        msg = {
            "type": "play",
            "data": {
                "player": player_name,
                "cards": cards,
                "cards_left": len(room.players[player_name].cards),
                "current_turn": room.get_current_player_name(),
                "your_cards": p.cards if name == room.get_current_player_name() or name == player_name else None,
                "card_type": room.last_play_type.value if room.last_play_type else None
            }
        }
        # 每个人都能看到自己的手牌更新
        if name != player_name:
            msg["data"]["your_cards"] = p.cards
        else:
            msg["data"]["your_cards"] = p.cards
        await safe_send(p.ws, msg)

async def broadcast_pass(room: GameRoom, player_name: str, new_round: bool):
    for name, p in room.players.items():
        msg = {
            "type": "player_pass",
            "data": {
                "player": player_name,
                "new_round": new_round,
                "current_turn": room.get_current_player_name(),
                "your_cards": p.cards
            }
        }
        await safe_send(p.ws, msg)

async def broadcast_game_end(room: GameRoom, result: Dict):
    for name, p in room.players.items():
        msg = {
            "type": "game_end",
            "data": result
        }
        msg["data"]["your_chips"] = p.chips
        msg["data"]["your_games_played"] = p.games_played
        msg["data"]["your_games_won"] = p.games_won
        await safe_send(p.ws, msg)

    # 试玩模式自动准备下一局
    if room.is_solo_mode and len(room.players) == 3:
        for p_name, p in room.players.items():
            p.ready = True
        await broadcast_room_state(room)
        if room.all_ready():
            room.start_game()
            await broadcast_game_start(room)

async def broadcast_chat(room: GameRoom, player_name: str, text: str):
    for name, p in room.players.items():
        msg = {
            "type": "chat",
            "data": {"player": player_name, "msg": text}
        }
        await safe_send(p.ws, msg)

# 挂载静态文件 - 必须放在最后
app.mount("/static", StaticFiles(directory="static", html=True), name="static")