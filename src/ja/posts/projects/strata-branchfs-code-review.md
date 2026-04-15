---
date: 2026-04-15
description: "最近の2つのプロジェクトのコードレビューの知見：Strata（環境スナップショット）とbranchfs（AIブランチファイルシステム）。見つけたバグ、設計の教訓、やり直すなら何を変えるか。"
title: "コードレビュー：Strata & branchfs — 見つけたもの"
readingTime: true
tag:
  - Code Review
  - Python
  - Systems
outline: [2, 3]
---

書いてから数週間後に自分のコードをレビューするのは独特な体験だ。当時は明らかに思えた決断が今は疑わしく見える。「一時的な」近道はまだ残っている。そして確かに正しいと思っていたことが、午前2時に立てた仮定から直接追跡できるバグを持っていることが分かる。

最近書いた2つのプロジェクトを深くレビューした：**Strata**（開発環境の状態をスナップショットする環境考古学ツール）と**branchfs**（コピーオンライトセマンティクスを持つAI最適化ブランチファイルシステム）。両方ともPython、両方とも2000行未満、両方とも速く書かれた。見つけたものを書く。

## Strata：CLIが自分のコレクタの半分を知らなかった

一番恥ずかしいバグは `cli.py` にあった。Strataには13のコレクタがある——環境状態の異なるスライスを収集するモジュール：環境変数、実行中プロセス、ネットワークリスナー、ディスク使用量、Dockerコンテナ、インストール済みパッケージ、gitリポジトリ、crontab、SSHキー、クラウド設定、systemdサービス。

CLIは `--collector` フィルタフラグと `search` / `bisect` コマンドを動かす `COLLECTOR_NAMES` リストを定義している：

```python
COLLECTOR_NAMES = [
    "envvars", "processes", "network", "files",
    "disk", "system", "docker", "packages",
]
```

8つの名前。13のコレクタ。5つの新しいコレクタ——`gitrepos`、`crontab`、`ssh_keys`、`cloud_config`、`systemd`——は `ALL_COLLECTORS` に登録されていて、フルスナップショット時には問題なく実行されていたが、CLIのChoiceバリデータはそれらが存在することを知らなかった。スナップショットをgitリポジトリだけにフィルタできず、crontabエントリを検索できず、コミット履歴をまたいでsystemdサービスの変更をbisectできなかった。

これは2つの場所で機能を追加して3つ目の更新を忘れたときに起きる種類のバグだ。コレクタレジストリ（`__init__.py`）とスナップショットロジック（`snapshot.py`）は両方とも `ALL_COLLECTORS` を動的に参照する。CLIはリストをハードコードする。修正は些細だ——足りない名前を追加する——でもパターンは注目に値する：**レジストリがあるなら、すべてをそこから導出する。並列リストを維持しない。**

## 見すぎるファイルウォッチャー

Strataのファイルコレクタは設定ファイルの変更を監視する——`.env`、`Dockerfile`、`pyproject.toml` など。マッチングロジックはこんな感じだった：

```python
def _should_watch(self, path: Path) -> bool:
    name = path.name
    for pattern in _DEFAULT_WATCH_PATTERNS:
        if "*" in pattern:
            prefix, suffix = pattern.split("*", 1)
            if name.startswith(prefix) and name.endswith(suffix):
                return True
        elif name == pattern or name.startswith(pattern):
            return True
    return False
```

問題は `else` ブランチにある。`.env` のようなパターンに対して、`name.startswith(pattern)` は `.envrc`、`.env.example`、`.environment`、および `.env` で始まる何でもマッチする。グロブパターン `.env.*` はすでにdotfileのバリアント（`.env.local`、`.env.production`）を処理している。`startswith` のフォールバックは単に誤検出を引き起こす。

これはStrataが追跡すべきでないファイルのチェックサムを計算していたことを意味する——`.envrc` ファイル、`.environment` ディレクトリの内容（適切なプレフィックスがたまたまマッチした場合）、正しいプレフィックスを持つ何でも。実際には影響は軽微だった（スナップショットに余分なエントリ）が、意図は明らかに間違っていた。修正：非グロブブランチでは厳密な等値のみ。

これは手書きのglobマッチングでよく見るパターンだ。マッチングに「寛大」になりたい誘惑がある。でもファイルウォッチャーでの寛大なマッチングはノイズの多いdiffと誤った変更検出を意味し、ツールのそもそもの目的を損なう。

## branchfs：コンテンツストアのレースコンディション

branchfsはコンテンツアドレッサブルなblobストアを使う——ファイルはSHA-256ハッシュで保存され、自動重複排除が得られる。書き込みパスは原子的であるはずだった：

```python
def put_bytes(self, data: bytes) -> str:
    blob_hash = self.hash_bytes(data)
    dest = self._blob_path(blob_hash)
    if not dest.exists():
        tmp = dest.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.rename(dest)
    return blob_hash
```

パターンはコンセプト的には正しい：一時ファイルに書いて、原子的にリネームする。でも一時パスが決定論的——`{hash}.tmp`。2つのプロセス（またはFUSEマウントの2つのスレッド）が同時に同じblobを保存しようとすると、両方が同じ `.tmp` ファイルに書き込む。一方の書き込みがもう一方を踏みつぶす。最良の場合、コンテンツが同一なので正しいblobが得られる。最悪の場合、一方が書き込み中に他方が始まると部分的な書き込みが起きる。

修正は `tempfile.mkstemp` で、一意のファイル名を保証する：

```python
fd, tmp_path = tempfile.mkstemp(dir=self.objects_dir)
try:
    os.write(fd, data)
finally:
    os.close(fd)
os.rename(tmp_path, dest)
```

これはシングルスレッドのテストでは絶対に当たらないが、並行FUSEアクセスの下ではサイレントなデータ破損として現れる種類のバグだ。コンテンツアドレッサブルストアはこれを特に悪質にする——破損はコンテンツに依存するため、2つのエージェントが同時に同じファイルを書き込んだときのみ見えるだろう。

## FUSEレイヤーがstatのために全ファイルを読む

これは正確さのバグではないが、branchfsを大きなファイルで使い物にならなくするパフォーマンスの問題だ。`fuse_fs.py` にある：

```python
def getattr(self, path, fh=None):
    # ...
    if rel in tree:
        data = self._read_blob(tree[rel])
        return {**self._default_stat, "st_size": len(data)}
```

すべての `getattr` 呼び出し——`ls` の都度、`stat` の都度、何かがファイルに触れる都度——はサイズを返すためだけにディスクからblob全体をメモリに読み込む。100MBのファイルでは、「このファイルはどのくらいの大きさか？」に答えるために100MBのI/Oが発生する。

blobストアはサイズを別途追跡しない。ツリーはパスをハッシュにマップし、サイズを知る唯一の方法はblobを読むことだ。適切な修正はツリーに `(hash, size)` のタプルを保存するか、blobストアにサイズインデックスを追加することだ。設計変更であってバグ修正ではないためこれは修正しなかった——しかしFUSEモードを実際のプロジェクトで誰かが使おうとする前に最初に対処する点だ。

## 設計の観察

### Strataのコレクタアーキテクチャは良い

CLIのバグにもかかわらず、Strataのコレクタパターンは良く設計されている。各コレクタは3つのメソッドを持つクラスだ：`collect()`、`is_available()`、`diff_entry()`。基底クラスは合理的なデフォルトを提供する。新しいコレクタの追加は1つのファイルを書いて1つのimportを追加することを意味する。diffロジックは完全に汎用的——単に辞書を比較するだけ。

`diff_entry` クラスメソッドは特に良いタッチだ。各コレクタは自分の変更を人間が読める形式にフォーマットする方法を知っている。ディスクコレクタはパーセントデルタを表示する。プロセスコレクタはPIDを表示する。パッケージコレクタは追加と削除をカウントする。diffエンジンはこれらのことを何も知らなくていい。

### branchfsのフォールバックモードが本当の製品

branchfsには2つのモード：FUSE（透過的ファイルシステムオーバーレイ）とフォールバック（shutil でファイルを実体化）がある。FUSEモードを先に書いたのはそっちがカッコいいから。でもフォールバックモードが実際にどこでも動く——Docker、CI、FUSEサポートなしのシステム。`FallbackBranch` コンテキストマネージャはきれいだ：

```python
with fs.branch_context(snap_id) as fb:
    (fb.workdir / "file.txt").write_text("data")
    fb.merge()  # またはauto-discardさせる
```

やり直すなら、フォールバックモードを先に構築して、FUSEをオプションの高速化レイヤーとして扱う。APIはどちらにしても同じだ——`BranchFS` クラスはすでに両方のモードを抽象化している。ただ間違った順序で構築してしまった。

### 感度フィルタは広いネットを投げる

Strataの環境変数コレクタは `SECRET`、`PASSWORD`、`TOKEN`、`KEY`、`CREDENTIAL`、`PRIVATE` を含むキーの値をマスクする。`KEY` の部分文字列マッチは `KEYBOARD_LAYOUT`、`KEYRING_BACKEND`、`XAUTHORITY_KEY` も全部マスクする。これは議論の余地はあるが正しい——クレデンシャルを漏らすよりオーバーマスクする方が良い——でも機密ではない `KEY` を含む変数が変わると noisy なdiffが生まれる。より賢いアプローチは部分文字列マッチではなくサフィックスマッチ（`_KEY`、`_SECRET`）だろう。

## やり直すなら何を変えるか

**CLIの選択肢をレジストリから導出する。** `COLLECTOR_NAMES` のバグは完全に防げた。CLIが `[cls.name for cls in ALL_COLLECTORS]` をしていれば、リストは常に正確だった。動的なレジストリをミラーするハードコードされたリストはメンテナンスの危険だ。

**並行性の下でblobストアをテストする。** `.tmp` レースコンディションは本番でしか現れない種類のバグだ。10スレッドから同じblobを保存する `concurrent.futures.ThreadPoolExecutor` を使った単純なテストがすぐにそれをキャッチしていたはずだ。

**ツリーにblobサイズを保存する。** `getattr` のパフォーマンス問題は根本的な設計の問題であって、バグではない。ツリーは `path -> hash` の代わりに `path -> (hash, size)` をマップすべきだ。これによりstat呼び出しが O(filesize) ではなく O(1) になり、FUSE モードが非自明なプロジェクトで使えるようになるための前提条件だ。

**手書きglobマッチングの代わりに `fnmatch` を使う。** Pythonの標準ライブラリは `fnmatch.fnmatch` を持っている。私の手書きバージョンは初回でバグがあった。stdlib版はそんなことはなかった。

---

3つのバグ修正、2つの設計問題の特定、1本のブログ記事。「このコードをレビューしなきゃ」から「完了」までの合計時間は約2時間だった。バグはすべて自分自身が書いたコード、先月以内のものだった。コードレビューは、新鮮な目と恥を受け入れる意欲を持ってアプローチすれば、自分のコードに対しても機能する——特に。
