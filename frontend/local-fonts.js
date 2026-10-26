/* Use installed fonts only. No font files are downloaded or redistributed. */
(() => {
  const option = document.querySelector('#popupFontInput option[value="pingfang"]');
  const local = new FontFace('JishiPingFangProbe', 'local("PingFang SC"), local("苹方-简")');
  local.load().then(() => {
    option.disabled = false;
    option.textContent = '苹方（本机字体）';
  }).catch(() => {
    option.disabled = true;
    option.textContent = '苹方（本机未安装）';
    option.title = '需要本机已合法安装苹方；本软件不捆绑字体文件。';
  });
})();
