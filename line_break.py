#!/usr/bin/env python3
"""
日本語テキスト字幕改行ツール
BudouX による自然な文節分割 + DP最適化
"""

import re
import sys
import math
from functools import lru_cache

import budoux

MAX_CHARS = 30      # 1行の最大実効文字数（句読点を除く）
TARGET_PER_LINE = 22  # 1行あたりの目標文字数（推奨行数計算に使用）

_parser = budoux.load_default_japanese_parser()


# ─────────────────────────────────────────
# ユーティリティ
# ─────────────────────────────────────────

def eff_len(s: str) -> int:
    """句読点を除いた実効文字数"""
    return sum(1 for c in s if c not in '、。')


def get_chunks(text: str) -> list[str]:
    """BudouXで文節に分割"""
    text = text.strip()
    return _parser.parse(text) if text else []


# ─────────────────────────────────────────
# 改行ボーナス計算
# ─────────────────────────────────────────

_LONE_PARTICLES = set('はがをのにでへとも')

def break_bonus(chunks: tuple[str, ...], j: int) -> int:
    """
    チャンクjの前で改行することへのボーナス（負ほど良い改行位置）。
    ボーナスはチャンクj-1の末尾・チャンクjの先頭で判定。
    """
    n = len(chunks)
    bonus = 0

    if j > 0:
        prev = chunks[j - 1]
        if prev.endswith('たら') or prev.endswith('れば'):
            bonus -= 7   # 条件節末尾（最強の改行位置）
        elif prev.endswith('、'):
            quote_depth = sum(c.count('「') - c.count('」') for c in chunks[:j])
            if quote_depth == 0:
                bonus -= 9   # 読点での区切り（構造的な節境界）
        elif prev.endswith('から') or prev.endswith('まで'):
            bonus -= 4   # 複合助詞
        elif prev.endswith('が') or prev.endswith('は'):
            bonus -= 4   # 主語・主題助詞
        elif prev.endswith('を') or prev.endswith('に'):
            bonus -= 2   # 格助詞
        elif prev.endswith('の'):
            bonus -= 1   # 連体助詞
        elif prev.endswith('て') or prev.endswith('で'):
            bonus -= 1   # テ形（弱い改行）

    if j < n:
        if chunks[j][0] == '「':
            bonus -= 5   # 引用開始は自然な改行ポイント
        elif chunks[j][0] in _LONE_PARTICLES:
            bonus += 4   # 助詞で行頭はNG

    return bonus


# ─────────────────────────────────────────
# DP最適改行（BudouXチャンクを使用）
# ─────────────────────────────────────────

def dp_break_chunks(
    chunks: list[str],
    max_chars: int = MAX_CHARS,
    target_per_line: int = TARGET_PER_LINE,
) -> list[str]:
    """
    BudouXチャンクリストを max_chars 以内の行に分割。
    推奨行数 = ceil(total / target_per_line) を目標とし、
    スコア = max_raw_eff + sum_break_bonuses（小さいほど良い）を最小化。
    """
    if not chunks:
        return []

    n = len(chunks)
    chunks_t = tuple(chunks)

    cumeff = [0] * (n + 1)
    for i, c in enumerate(chunks):
        cumeff[i + 1] = cumeff[i] + eff_len(c)

    total = cumeff[n]

    if total <= max_chars:
        return [''.join(chunks)]

    min_n = math.ceil(total / max_chars)
    preferred_n = max(min_n, math.ceil(total / target_per_line))

    # preferred_n → preferred_n+1 → ... の順で探索
    for target_n in [preferred_n, preferred_n + 1, preferred_n - 1]:
        if target_n < min_n:
            continue
        result = _search_n_lines(chunks_t, cumeff, n, target_n, max_chars)
        if result:
            return result

    return _force_break_chunks(chunks, max_chars)


def _search_n_lines(
    chunks: tuple,
    cumeff: list,
    n: int,
    n_lines: int,
    max_chars: int,
) -> list[str] | None:
    """
    exactly n_lines 行での最適分割を探索。
    スコア = max_raw_eff - sum_bonuses（降順）を最小化。
    戻り値: 行リスト or None（不可能な場合）
    """

    @lru_cache(maxsize=None)
    def search(start: int, remaining: int):
        """
        Returns (adj_score, raw_max, total_bonus, path) or None.
        adj_score = raw_max + total_bonus (小さいほど良い).
        """
        if remaining == 1:
            seg = cumeff[n] - cumeff[start]
            if seg <= 0 or seg > max_chars:
                return None
            return (seg, seg, 0, (n,))

        best = None
        for end in range(start + 1, n):
            seg = cumeff[end] - cumeff[start]
            if seg > max_chars:
                break
            if seg == 0:
                continue

            sub = search(end, remaining - 1)
            if sub is None:
                continue

            bb = break_bonus(chunks, end)
            sub_adj, sub_raw, sub_bonus, sub_path = sub

            cur_raw = max(seg, sub_raw)
            cur_bonus = bb + sub_bonus
            cur_adj = cur_raw + cur_bonus  # lower = better
            # Penalize ending a line with an unclosed 「
            open_q = sum(c.count('「') - c.count('」') for c in chunks[start:end])
            if open_q > 0:
                cur_adj += 8

            if best is None or cur_adj < best[0]:
                best = (cur_adj, cur_raw, cur_bonus, (end,) + sub_path)

        return best

    result = search(0, n_lines)
    search.cache_clear()

    if result is None:
        return None

    _, _, _, path = result
    lines, start = [], 0
    for end in path:
        seg = ''.join(chunks[start:end]).strip('、')
        if seg:
            lines.append(seg)
        start = end

    return lines if len(lines) == n_lines else None


def _force_break_chunks(chunks: list[str], max_chars: int) -> list[str]:
    """フォールバック: 強制分割"""
    lines, buf, buf_eff = [], '', 0
    for c in chunks:
        ce = eff_len(c)
        if buf_eff + ce > max_chars and buf:
            lines.append(buf.strip('、'))
            buf, buf_eff = c, ce
        else:
            buf += c
            buf_eff += ce
    if buf:
        lines.append(buf.strip('、'))
    return lines


# ─────────────────────────────────────────
# 文・段落レベル処理
# ─────────────────────────────────────────

def process_sentence(sentence: str, max_chars: int = MAX_CHARS) -> list[str]:
    """
    1文（。なし）を字幕行に変換。
    BudouXでチャンク化 → DP最適改行。
    """
    sentence = sentence.strip()
    if not sentence:
        return []
    if eff_len(sentence) <= max_chars:
        return [sentence]

    chunks = get_chunks(sentence)
    if not chunks:
        return [sentence]

    return dp_break_chunks(chunks, max_chars)


def process_annotated(para: str, max_chars: int) -> list[str]:
    """✔ などの注釈を含む段落を処理"""
    lines = []
    parts = re.split(r'\s*(?=✔)', para)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if part.startswith('✔'):
            core = part.rstrip('。')
            # ✔アイテム末尾の後付きテキストを分離
            m = re.match(
                r'(✔[︎\s]*\S+(?:ない|する|いる|れる|された|ます|です|だ|い))\s+(.*)',
                core
            )
            if m:
                bullet, trailing = m.group(1).strip(), m.group(2).strip()
                if bullet:
                    lines.extend(process_sentence(bullet, max_chars))
                if trailing:
                    lines.extend(process_sentence(trailing, max_chars))
            else:
                lines.extend(process_sentence(core, max_chars))
        else:
            core = part.rstrip('。')
            lines.extend(process_sentence(core, max_chars))
    return lines


def process_paragraph(para: str, max_chars: int = MAX_CHARS) -> list[str]:
    """段落を字幕行リストに変換"""
    if not para.strip():
        return []

    if re.search(r'[✔※●▶]', para):
        return process_annotated(para, max_chars)

    lines = []
    for sent in re.split(r'(?<=。)', para.strip()):
        sent = sent.strip()
        if not sent:
            continue
        core = sent[:-1] if sent.endswith('。') else sent
        if core:
            lines.extend(process_sentence(core, max_chars))
    return lines


# ─────────────────────────────────────────
# 全体処理
# ─────────────────────────────────────────

def stage1_linebreak(text: str, max_chars: int = MAX_CHARS) -> str:
    """ステージ1: 改行処理"""
    result = []
    for para in text.strip().split('\n'):
        para = para.strip()
        if not para:
            result.append('')
            continue
        result.extend(process_paragraph(para, max_chars))
        result.append('')
    while result and result[-1] == '':
        result.pop()
    return '\n'.join(result)


def stage2_finalize(text: str) -> str:
    """ステージ2: 句読点を全て削除して完成"""
    return text.replace('。', '').replace('、', '')


def print_with_count(text: str):
    for line in text.split('\n'):
        if line:
            count = eff_len(line)
            marker = ' ⚠️ ' if count > MAX_CHARS else ''
            print(f'{line}  [{count}]{marker}')
        else:
            print()


# ─────────────────────────────────────────
# サンプルテキスト
# ─────────────────────────────────────────
SAMPLE = """始まった日本企業の"逆襲"

先月、私たちがご紹介したある日本企業の株価が2日連続ストップ高を記録しました。

3月24日に前日比約17%上昇。3月25日にはさらに約15%上昇。わずか2日間で34%の上昇です。

もし10万円投資していたら3.4万円の含み益、100万円投資していたら34万円の含み益が得られていたということです。

もしかするとあなたは先月のご案内を見て「今回は見送った」という方かもしれません。

もしそうであればこの2日間の上昇は"取り逃がした利益"だった可能性があります。

では、なぜここまで株価が急騰したのでしょうか？

理由は明確です。

世界一の投資家ウォーレン・バフェット氏が率いるバークシャー・ハサウェイが約2,800億円の投資を発表したからです。

ですが、ここで重要なのは"株価が上がったこと"ではありません。

バフェット氏は ✔︎ 割高な企業には投資しない ✔︎ 長期的に成長する企業にしか投資しない ことで知られています。

つまり今回の投資は「この企業はまだ伸びる」と判断された証拠とも言えるからです。

そして実はこの企業、先月私たちがご案内した「日の丸エリート・ポートフォリオ」でご紹介している企業です。

つまり、今回の上昇は単なる偶然ではなく、「こうした企業を見つける仕組みが機能した結果」とも言えます。

だからこそ今回、この情報をあなたにもう一度お届けしています。

そして、日の丸エリート・ポートフォリオでご紹介している5つの企業は株価の上昇だけでなく、高い配当成長率が期待できる企業です。

これまで高い配当成長率を記録するある特定の日本株は米国株を圧倒してきました。

また、配当成長率はOxfordクラブのマークさんも大事にしている指標の一つであり、マークさんはこんなことを言っています。

ただ増配企業リストの仲間入りをしたいがために毎年0.5ペンスずつしか増配しない会社はあなたのゴールを達成する手助けにはならないだろう。あなたが確認すべきなのは「配当成長率」である。

そして、マークさんは日本株についてこんなことも言っているんです。

ご存じの通り、今の日本株市場はとても熱い状況です。株価は過去の高値まで戻っていますし、これによって世界中の注目がさらに集まるようになると思います。というのも、長年にわたって「日本市場は1991年、つまり90年代初頭の水準から回復していない」と言われ続けてきました。

しかし今、それがついに回復しました。その結果、人々は「日本で何が起きているのか？」「なぜこうなっているのか？」と、日本株市場に目を向け始めているのです。

ですから、日本株市場にはこれから勢いが生まれてくると思います。今回の出来事はとてもワクワクすることです。

しかも、これはウォール街のプロや業界関係者の間だけで話題になっているわけではありません。最近では一般のメディアでも取り上げられるようになっています。

ですから、これから多くの人が日本株市場に注目するようになると思います。

バブル経済崩壊以降、日本株は長年低迷し米国株に遅れをとってきました。

ただ、この流れが変わりつつあり、ウォーレン・バフェット氏やマークさんも日本株に注目し始めているんです。

そんな"逆襲"を始めた日本株の中でも特に高い配当成長と株価上昇が期待できる銘柄を厳選したのが、日の丸エリート・ポートフォリオ〜選れた5つのエリート配当グロース株〜です。

今日あなたにこの5銘柄を4月30日（木）までの期間限定で、実質無料で公開します。

ここからはその5銘柄を実質無料で知る方法と、日の丸エリート・ポートフォリオの詳細をお伝えしていきますので、このまま続きをご覧ください。

また、動画の最後では4月27日（月）までの期間限定特典についてお伝えしているので、ぜひ最後までご覧ください。"""


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='日本語字幕改行ツール')
    parser.add_argument('--sample', action='store_true', help='サンプルで動作確認')
    parser.add_argument('--finalize', action='store_true', help='ステージ2: 句読点削除')
    parser.add_argument('--max', type=int, default=MAX_CHARS, help=f'最大文字数 (default:{MAX_CHARS})')
    parser.add_argument('file', nargs='?', help='入力ファイル（省略時はstdin）')
    args = parser.parse_args()

    if args.sample:
        text = SAMPLE
    elif args.file:
        with open(args.file, 'r', encoding='utf-8') as f:
            text = f.read()
    else:
        text = sys.stdin.read()

    result = stage1_linebreak(text, args.max)

    if args.finalize:
        result = stage2_finalize(result)
        print(result)
    else:
        print_with_count(result)
