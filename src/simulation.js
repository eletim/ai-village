/** Frontend-only demonstration. No remote execution or generated work occurs. */
export const STAGES = [
  { duration:6000, chapter:0, title:'ひとつのアイデアから、村が動き出す', status:'村長の家でお待ちしています' },
  { duration:6500, chapter:1, title:'ミクが、依頼を持って工房へ', status:'第一工房へ向かっています' },
  { duration:6500, chapter:1, title:'工房に集まって、仕事の相談', status:'工房の仲間に依頼を伝えています' },
  { duration:6500, chapter:2, title:'それぞれの得意を持ち寄って', status:'村長の家へ戻っています' },
  { duration:8000, chapter:2, title:'工房から、ものづくりの音', status:'工房からの便りを待っています' },
  { duration:8500, chapter:3, title:'できあがったものを、村長の家へ', status:'リツが成果を届けに来ています' },
  { duration:7000, chapter:4, title:'届いた成果を、いっしょに確かめる', status:'ハルと一緒に成果を確認しています' },
  { duration:14000, chapter:4, title:'村長、新しい便りが届きました', status:'村長への報告ができました' },
];
export class VillageSimulation {
  constructor(){this.onStage=()=>{};this.reset()}
  reset(){this.stage=0;this.elapsed=0;this.request='';this.completed=false}
  get progress(){return this.elapsed/STAGES[this.stage].duration}
  start(request){this.request=request;this.stage=1;this.elapsed=0;this.completed=false;this.onStage()}
  advance(delta){
    if(this.completed)return;
    this.elapsed+=delta;
    while(this.elapsed>=STAGES[this.stage].duration){
      if(this.stage===STAGES.length-1){this.elapsed=STAGES[this.stage].duration;this.completed=true;break}
      this.elapsed-=STAGES[this.stage].duration;this.stage++;this.onStage();
    }
  }
  get message(){
    const idea=this.request?`「${this.request}」`:'サービスの画面づくり';
    return [
      '村長、おかえりなさい。今日は3つの工房で、ものづくりが進んでいます。つくりたいものがあれば、私に話してくださいね。',
      `${idea}ですね。第一工房のみんなに伝えてきます。`,
      `レンを中心に、ソラとユイにも加わってもらいます。${idea}について、3人で相談を始めています。`,
      '工房に依頼を伝えてきました。みんな、さっそく取りかかっています。できあがりを楽しみに待ちましょう。',
      '第一工房は画面づくり、第二工房は動作確認が進んでいます。第三工房でも、小さな試作品ができたようです。',
      '第三工房のリツが、試作品を運んできてくれています。届いたら、ハルと一緒に確かめますね。',
      '試作品が届きました。いま、画面を開いて操作を確かめています。村長にお見せできるよう、まとめています。',
      `村長、試作品を確認しました。最初の画面から入力、結果の表示まで、一通り試せる形になっています。次につくりたいものも、いつでも話してください。`,
    ][this.stage];
  }
  get event(){return [
    '村長の家で、新しいアイデアを待っています。',
    this.request?`村長の依頼を持って、ミクが工房に向かいました。`:'ミクが第一工房へ向かいました。',
    'レン、ソラ、ユイが集まり、依頼の相談をしています。',
    '第一工房で制作が始まり、ミクが村長の家へ戻ります。',
    'それぞれの工房で、ものづくりが進んでいます。',
    'リツが試作品を持って、第三工房を出発しました。',
    '成果が到着。ミクとハルが確認しています。',
    'ミクが成果を確認し、村長への報告をまとめました。',
  ][this.stage]}
}
