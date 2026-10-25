# 今回の工房検証結果（2026-10-25）

成果ソースの絶対パスは `/home/eletim/ai-village-workshop/b93e61bc-d900-429a-bf95-5feaa0e87cb7/source`。
専用runtimeは `/home/eletim/ai-village-workshop/b93e61bc-d900-429a-bf95-5feaa0e87cb7/scratch-runtime-v4`。今回専用場所で一人で作業し、旧工房・コア・他端末は操作していない。

ベース `7000a41834ce3a2b7d6764c62fed3d736db0e010` を確認し、指定仕事専用Git接続から保存ブランチ `village/work-c931647f-9c45-4cc3-b70b-62bc2913a07d` をfetch。先端が `16a05f94657e31b379294f6734842d2a1c889738` と一致することを確認してfast-forwardで取り込んだ。既存の信頼済みworkspace exec、担当CLI、復旧・承認処理を保持。

| 実測 | 結果 | ソース内のログ |
| --- | --- | --- |
| sudoなしbootstrap | 成功。Pillow12.3.0、libcap2.76、libseccomp2.5.5、bwrap0.11.0、Noto Sans2.004 | `.runtime/bootstrap-v4.log` |
| バージョン・整合性・必須実隔離 | PASS、scratch 7/7、skip0 | `.runtime/preflight-final.log` |
| Node全体（設定あり） | 121/121、失敗0、skip0 | `.runtime/node-final.log` |
| Node全体（設定なし） | 117成功、失敗0、skip4（実隔離/中断/秘書fixture実隔離/実supervisor再起動は未実施） | `.runtime/node-disabled-final.log` |
| 最終worker snapshot・設定回帰 | 6/6、skip0 | `.runtime/config-worker-final.log` |
| UI全体（実Chrome） | 28/28、skip0 | `.runtime/ui-tests.log` |
| 最終scratch関連UI | 2/2、skip0（上記の部分集合） | `.runtime/ui-scratch-final.log` |
| check / build / diff --check | 成功 | `.runtime/check.log`, `.runtime/build.log`, `.runtime/diff-check.log` |
| bwrap動的依存 | libcとloaderのみ。システムlibcapに依存しない | `.runtime/bwrap-ldd.log` |

bootstrapは専用場所から実行し、pkg-config検索先をローカルlibcapだけに制限。システムbwrapやシステムNotoを実行経路に使わず、専用runtimeで実測した。初期のarchive symlink拒否とlibseccompのgperf要求は修正済みで、最終v4導入は完走。中断した版は活性化していない。

実bwrap/seccompでfork/socket/領域外書込み拒否、フォント1ファイルだけの可視性と読取専用性、CPU/メモリ/出力/ファイル容量制限、永続化、cancel/get、SIGKILL後unknownと再実行拒否を検証。Pillowとlibseccompのバージョンも隔離内で確認した。[今回の日本語PNG](secretary-work-evidence/bootstrap-japanese.png) を生成し、ImageStoreでデコードして、画像を実際に開き文字表示を確認した。生の実行記録は `.runtime/current-evidence/`。

永続設定の再起動試験は実supervisorと実backendを使用。不正設定でも既存backendが起動し、状態ディレクトリへ正しいJSONを保存してsupervisor再起動要求を出すと、instanceIdが変わりscratch.available=trueになった。runtime環境値はexportしていない。

反映試験はコピー済みの実workerと実doctorを実行したが、Git/npmはfixtureで、merge直前に停止している。未設定はNOT RUN、必須設備不足と永続設定先の欠落は取り込み前失敗と確認。コア反映・リモートmerge・本番再起動の実測ではない。秘書の意思決定と会話表示はfixtureであり、今回実Codexの自然言語判断は再検証していない。旧成果の画像・実Codex記録を今回の実測として数えていない。

未完了はコアでの初回bootstrap、同一SHAのpreflight/Node/UI/build、永続設定の適用確認、既存反映窓口での反映、反映後の稼働確認。工房Pushだけで利用可能とは報告しない。秘書用の具体的なコマンドと旧worker対策は [コア導入手順](scratch-core-bootstrap.md)。今回の仕事は自動反映しない。報告承認・Agent解放・main操作はしていない。
