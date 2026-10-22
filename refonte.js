/* Hero patterns: a dot-matrix field (like a ticket printer) that prints in once,
   then keeps drifting slowly. Static when the visitor prefers reduced motion. */
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function smooth(a, b, x) {
    x = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }

  function matrix(canvas) {
    var ctx = canvas.getContext("2d");
    var calm = canvas.dataset.matrix === "calm";
    var step = calm ? 26 : 22;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var start = performance.now();
    var W = 0, H = 0, cols = 0, rows = 0, raf = 0, last = 0, visible = true;

    function resize() {
      var box = canvas.getBoundingClientRect();
      W = box.width;
      H = box.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(W / step) + 1;
      rows = Math.ceil(H / step) + 1;
      draw(reduce ? 4000 + start : performance.now());
    }

    function draw(now) {
      var t = (now - start) / 1000 * (calm ? 0.7 : 1);
      var ramp = reduce ? 1 : smooth(0, 1.8, t);
      var narrow = W < 720;
      ctx.clearRect(0, 0, W, H);
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var x = i * step, y = j * step, u = x / W, w = y / H;
          var mask = narrow
            ? smooth(0.7, 1, u) * 0.35
            : smooth(0.42, 0.95, u) * (1 - smooth(0.55, 1, w) * 0.6);
          mask *= smooth(80, 170, y);
          if (mask <= 0.02) continue;
          var f = (Math.sin(i * 0.21 + t * 0.55) + Math.sin(j * 0.29 - t * 0.42) + Math.sin((i + j) * 0.11 + t * 0.3) + 3) / 6;
          var v = f * f * mask * ramp * (calm ? 0.75 : 1);
          var r = v * step * 0.46;
          if (r < 0.7) continue;
          ctx.fillStyle = v > 0.6
            ? "rgba(95,211,141," + Math.min(1, v + 0.15).toFixed(2) + ")"
            : "rgba(60,139,245," + (0.3 + v * 0.7).toFixed(2) + ")";
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 6.2832);
          ctx.fill();
        }
      }
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      draw(now);
    }

    function play() {
      if (reduce || raf || !visible || document.hidden) return;
      raf = requestAnimationFrame(loop);
    }

    function pause() {
      cancelAnimationFrame(raf);
      raf = 0;
    }

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", function () { document.hidden ? pause() : play(); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        visible ? play() : pause();
      }).observe(canvas);
    }
    play();
  }

  document.querySelectorAll("canvas[data-matrix]").forEach(matrix);

  if (reduce) {
    document.querySelectorAll("svg.rf-route").forEach(function (svg) {
      if (svg.pauseAnimations) svg.pauseAnimations();
    });
  }
})();
