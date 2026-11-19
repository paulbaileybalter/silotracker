App.init();
(function () {
  var host = document.getElementById('bubbles'); if (!host) return;
  for (var i = 0; i < 18; i++) {
    var s = document.createElement('span'), sz = 8 + Math.random() * 26;
    s.style.cssText = 'left:' + Math.random() * 100 + '%;width:' + sz + 'px;height:' + sz + 'px;animation-duration:' + (14 + Math.random() * 16) + 's;animation-delay:' + (-Math.random() * 24) + 's';
    host.appendChild(s);
  }
})();
