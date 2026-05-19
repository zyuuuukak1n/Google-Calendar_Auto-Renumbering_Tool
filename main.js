/**
 * Google Calendar Auto-Renumbering Tool
 * 過去の確定済みイベントをアンカー（基準）とし、指定パターンの連番を自動で再採番します。
 */

const CONFIG = {
  // =========================================================
  // 【ユーザー設定】 用途に合わせて正規表現とフォーマットを変更してください
  // =========================================================
  
  // 1. 対象イベントを特定・抽出する正規表現
  // 例 (Vol.001) : /^Vol\.(\d+)/
  // 例 (第001回) : /^【第(\d+)回】/
  MATCH_REGEX: /^【第(\d+)回】/,
  
  // 2. MATCH_REGEX の何番目のキャプチャグループ ( ) が「数字」に該当するか
  // 上記 /^【第(\d+)回】/ の場合、数字の (\d+) は1番目のカッコなので「1」
  NUMBER_GROUP_INDEX: 1,
  
  // 3. タイトルを書き換える際のフォーマット
  // {{NUMBER}} の部分が、自動計算された新しい連番に置換されます。
  // $1, $2 等を使用することで、MATCH_REGEX のグループ文字列を引き継ぐことも可能です。
  REPLACE_FORMAT: '【第{{NUMBER}}回】',
  
  // 4. 連番のゼロ埋め桁数（例: 3を指定すると '001', '012' になります。不要な場合は 1）
  NUMBER_PADDING: 3,
  
  // 5. 基準（アンカー）となる過去イベントを取得するための遡り日数
  FETCH_PAST_DAYS: 90,     
  
  // 6. 何日先までのイベントを処理対象とするか
  FETCH_FUTURE_DAYS: 180   
};

/**
 * 連番自動再採番のメインロジック
 */
function renumberEvents() {
  try {
    // 1. 環境変数（スクリプトプロパティ）からシークレット情報を取得
    const scriptProperties = PropertiesService.getScriptProperties();
    const calendarId = scriptProperties.getProperty('CALENDAR_ID');
    
    if (!calendarId) {
      throw new Error('環境変数に CALENDAR_ID が設定されていません。プロジェクト設定から追加してください。');
    }

    // 2. カレンダーインスタンスの取得と認可確認
    const calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) {
      throw new Error(`カレンダーID '${calendarId}' にアクセスできません。権限またはIDを確認してください。`);
    }

    // 3. 対象期間の算出（過去をアンカーとする）
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - CONFIG.FETCH_PAST_DAYS);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + CONFIG.FETCH_FUTURE_DAYS);
    endDate.setHours(23, 59, 59, 999);

    // 4. イベントの一括取得 (N+1問題の排除)
    const allEvents = calendar.getEvents(startDate, endDate);
    if (!allEvents || allEvents.length === 0) {
      console.info('指定期間内にイベントが存在しません。');
      return;
    }

    // 5. 正規表現で対象を絞り込み、時系列順（古い順）にソート
    const targetEvents = allEvents.filter(event => {
      return CONFIG.MATCH_REGEX.test(event.getTitle());
    }).sort((a, b) => a.getStartTime().getTime() - b.getStartTime().getTime());

    if (targetEvents.length === 0) {
      console.info('処理対象となるイベントが見つかりませんでした。正規表現(MATCH_REGEX)の設定を確認してください。');
      return;
    }

    // 6. 時系列で最も古いイベントの番号を、信頼できる初期番号（アンカー）とする
    const anchorEventTitle = targetEvents[0].getTitle();
    const match = anchorEventTitle.match(CONFIG.MATCH_REGEX);
    
    // 堅牢な入力値検証
    if (!match || !match[CONFIG.NUMBER_GROUP_INDEX]) {
      throw new Error(`アンカーイベント(${anchorEventTitle})の解析に失敗しました。MATCH_REGEX または NUMBER_GROUP_INDEX の設定に不整合があります。`);
    }
    
    let currentSequenceNumber = parseInt(match[CONFIG.NUMBER_GROUP_INDEX], 10);
    if (isNaN(currentSequenceNumber)) {
      throw new Error('抽出された値が数値ではありません。正規表現のキャプチャグループを見直してください。');
    }

    let updateCount = 0;

    // 7. 過去から未来へ向かって順番に再採番および差分更新処理
    targetEvents.forEach(event => {
      const originalTitle = event.getTitle();
      const newNumberStr = String(currentSequenceNumber).padStart(CONFIG.NUMBER_PADDING, '0');
      
      // 置換用フォーマット内の {{NUMBER}} を実際の数字に変換
      const dynamicReplacement = CONFIG.REPLACE_FORMAT.replace('{{NUMBER}}', newNumberStr);
      
      // 対象文字列の書き換え（正規表現のグループ参照 $1, $2 等もここで適用される）
      const newTitle = originalTitle.replace(CONFIG.MATCH_REGEX, dynamicReplacement);
      
      // 差分がある場合のみAPIリクエストを発行（クラウド課金・クオータ消費の最小化）
      if (originalTitle !== newTitle) {
        event.setTitle(newTitle);
        updateCount++;
        console.info(`【更新成功】 ${originalTitle} -> ${newTitle}`);
      }
      
      currentSequenceNumber++;
    });

    console.info(`【処理完了】 対象イベント総数: ${targetEvents.length}件, 更新実行数: ${updateCount}件`);

  } catch (error) {
    // 内部情報を過剰に漏洩させない監視用ログ出力
    console.error(`【システムエラー】再採番処理中に異常が発生しました: ${error.message}`);
  }
}
