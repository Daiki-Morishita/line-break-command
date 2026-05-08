#!/usr/bin/env python3
"""
日本語テキスト字幕改行ツール
動画字幕用 - 1行最大30文字（句読点を文字数に含めない）
"""

import re
import sys

MAX_CHARS = 30
MIN_SEG = 6  # この文字数未満の読点前セグメントは次と強制結合


def eff_len(s: str) -> int:
    """句読点を除いた実効文字数"""
    return sum(1 for c in s if c not in '、。')


def find_quote_ranges(text: str) -> list[tuple[int, int]]:
    """「...」 の範囲を返す（この中では改行しない）"""
    ranges = []
    start = None
    for i, c in enumerate(text):
        if c == '「':
            start = i
        elif c == '」' and start is not None:
            ranges.append((start, i))
            start = None
    return ranges


def in_quote(pos: int, ranges: list[tuple[int, int]]) -> bool:
    return any(s < pos <= e for s, e in ranges)


def get_break_candidates(text: str) -> list[int]:
    """
    自然な改行位置（インデックス）を返す。
    鉤括弧内では改行しない。
    """
    q_ranges = find_quote_ranges(text)
    candidates = set()
    n = len(text)

    for i, c in enumerate(text):
        if in_quote(i + 1, q_ranges):
            continue  # 鉤括弧内には改行を入れない

        # 鉤括弧の前で改行
        if c == '「' and i > 0 and not in_quote(i, q_ranges):
            candidates.add(i)
        # 鉤括弧の後で改行
        if c == '」' and i + 1 < n:
            candidates.add(i + 1)
        # 2文字複合助詞・条件形
        if i + 2 <= n:
            bigram = text[i:i+2]
            if bigram in {'から', 'まで', 'より', 'ので', 'たら', 'れば',
                          'ても', 'でも', 'には', 'では', 'とは', 'ては'}:
                candidates.add(i + 2)
        # 1文字助詞
        if c in 'はがをにへとも' and i + 1 < n:
            candidates.add(i + 1)
        elif c in 'てで' and i + 1 < n:
            # 「ていない」「ている」「ていた」の途中では改行しない
            if text[i + 1] not in 'いう':
                candidates.add(i + 1)
        elif c in 'のや' and i + 1 < n:
            candidates.add(i + 1)

    return sorted(candidates)


def dp_split(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    """
    DPで最適改行（最小行数 → 最大行長の最小化）。
    鉤括弧内は改行しない。
    """
    if eff_len(text) <= max_chars:
        return [text]

    n = len(text)
    eff = [0] * (n + 1)
    for i in range(n):
        eff[i + 1] = eff[i] + (0 if text[i] in '、。' else 1)

    total_eff = eff[n]
    if total_eff <= max_chars:
        return [text]

    cands = set(get_break_candidates(text))
    cands.add(0)
    cands.add(n)
    cands = sorted(cands)

    LONE_PARTICLES = set('はがをのにでへとも')

    def bad_break_penalty(pos: int) -> int:
        """次の行が助詞単独で始まる場合にペナルティを付与"""
        if pos < n and text[pos] in LONE_PARTICLES:
            # の/に/で の後ろが助詞でなければペナルティ
            return 4
        return 0

    INF = float('inf')
    dp = [(INF, INF, -1)] * (n + 1)
    dp[0] = (0, 0, -1)

    for i in cands:
        if dp[i][0] == INF:
            continue
        lines_n, max_l, _ = dp[i]
        for j in cands:
            if j <= i:
                continue
            seg_e = eff[j] - eff[i]
            if seg_e == 0:
                continue
            if seg_e > max_chars:
                break
            nl = lines_n + 1
            nm = max(max_l, seg_e) + bad_break_penalty(j)
            if nl < dp[j][0] or (nl == dp[j][0] and nm < dp[j][1]):
                dp[j] = (nl, nm, i)

    if dp[n][0] == INF:
        return _force_break(text, max_chars)

    path = []
    pos = n
    while pos > 0:
        path.append(pos)
        pos = dp[pos][2]
    path.reverse()

    lines, start = [], 0
    for end in path:
        seg = text[start:end].strip('、')
        if seg:
            lines.append(seg)
        start = end
    return lines


def _force_break(text: str, max_chars: int) -> list[str]:
    lines, remaining = [], text
    while eff_len(remaining) > max_chars:
        count = pos = 0
        for i, c in enumerate(remaining):
            if c not in '、。':
                count += 1
            if count >= max_chars:
                pos = i + 1
                break
        lines.append(remaining[:pos].strip('、'))
        remaining = remaining[pos:].strip('、')
    if remaining:
        lines.append(remaining)
    return lines


def process_sentence(sentence: str, max_chars: int = MAX_CHARS) -> list[str]:
    """
    1文（。なし）を字幕行に変換。
    戦略: 読点で分割 → 短いセグメントは次と結合 → max超過は助詞で分割
    """
    if eff_len(sentence) <= max_chars:
        return [sentence]

    # 読点で分割
    raw_parts = [p.strip() for p in sentence.split('、') if p.strip()]

    # 短いセグメント（MIN_SEG未満）を次のセグと強制結合
    merged = []
    buf = ''
    for part in raw_parts:
        if buf:
            if eff_len(buf) < MIN_SEG:
                buf = buf + part  # 短い → 強制結合（長くてもOK、後で分割）
            elif eff_len(buf + part) <= max_chars:
                buf = buf + part  # 合わせて30以内 → 結合
            else:
                merged.append(buf)
                buf = part
        else:
            buf = part
    if buf:
        merged.append(buf)

    # 各セグメントを処理してラインリストを作成（隣接ラインの結合も試みる）
    lines: list[str] = []
    pending = ''

    for seg in merged:
        if eff_len(seg) > max_chars:
            # 長すぎる → dp分割
            if pending:
                lines.append(pending)
                pending = ''
            lines.extend(dp_split(seg, max_chars))
        else:
            # pendingと結合できるか試みる
            combined = pending + seg if pending else seg
            if eff_len(combined) <= max_chars:
                pending = combined
            else:
                if pending:
                    lines.append(pending)
                pending = seg

    if pending:
        lines.append(pending)

    return lines


def process_annotated(para: str, max_chars: int) -> list[str]:
    """✔ などの注釈を含む段落を処理"""
    lines = []
    # ✔ を含む行を空白区切りで分割して各アイテムを処理
    parts = re.split(r'\s*(?=✔)', para)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # ✔アイテム末尾に後付きテキストがある場合を検出
        # パターン: ✔ [本文] [後付き]  (後付きは✔で始まらないひとまとまり)
        if part.startswith('✔'):
            # 末尾の。を取り除いて後付きを分離
            core = part.rstrip('。')
            # 動詞終止形後ろの後付きを分離 (スペース区切り)
            m = re.match(
                r'(✔[︎︎\s]*\S+(?:ない|する|いる|れる|された|ます|です|だ|い))\s+(.*)',
                core
            )
            if m:
                bullet = m.group(1).strip()
                trailing = m.group(2).strip()
                if bullet:
                    _extend(lines, bullet, max_chars)
                if trailing:
                    lines.extend(process_sentence(trailing, max_chars))
            else:
                _extend(lines, core, max_chars)
        else:
            # 前置きテキスト
            core = part.rstrip('。')
            lines.extend(process_sentence(core, max_chars))
    return lines


def _extend(lines: list, text: str, max_chars: int):
    if eff_len(text) <= max_chars:
        lines.append(text)
    else:
        lines.extend(dp_split(text, max_chars))


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
