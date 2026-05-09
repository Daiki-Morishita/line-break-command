# PROGRESS

## 2026-05-08
- 139_before/after.rtf を分析。改行ルールを学習。
- line_break.py 実装完了（ステージ1: 改行、ステージ2: 句読点削除）
- アルゴリズム: 読点優先分割 → DP最適化（最小行数→最大行長最小化）+ 行頭助詞ペナルティ + 鍵括弧内不改行 + 「ていない」途中不改行
- 使い方: `python3 line_break.py input.txt` で確認、`--finalize` で句読点削除

## 2026-05-09
- BudouXで文節分割に全面移行（pip install budoux）
- 改行ボーナス: たら/れば=-7, 、=-9(鍵括弧外のみ), が/は=-4, から/まで=-4, を/に=-2, の/て/で=-1, 「前=-5
- 鍵括弧内で行末になるペナルティ+8で引用句境界を保護

## 2026-05-09（Webアプリ化）
- index.html / style.css / app.js 作成
- BudouX ローカルバンドル（budoux.min.js、esbuildで生成）
- GitHub Pages でホスティング: https://daiki-morishita.github.io/line-break-command/
- リアルタイム処理、文字数ルーラー、句読点削除/空白行削除トグル

## 2026-05-09（アルゴリズム改良）
- preferred_n を ceil(total/22) から ceil(total/maxChars) に変更 → 行をmaxCharsに近づける
- ブロック内の日本語行を全結合してDPに渡す（global optimization）
- ASCII専用行（英語名など）はスタンドアロン保持
- ？！を文末区切りとして追加（。と同様に改行）
- この/その/あの/どの + 「...」の分断にペナルティ+8
- ✔/※/●/▶ を含む段落でも。/？/！ 分割を適用
