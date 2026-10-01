/* Accessible custom attachment player. No autoplay; only one clip plays at a time. */
class ChatAudio extends HTMLElement {
  connectedCallback() {
    if (this.player) return;
    const source = this.getAttribute("src");
    try {
      if (
        new URL(source, location.href).protocol !== "https:" &&
        !(["localhost", "127.0.0.1"].includes(location.hostname) && source.startsWith("/"))
      )
        return;
    } catch {
      return;
    }
    this.innerHTML =
      '<div class="audio-file"><span class="audio-file-icon">♫</span><div><a class="audio-filename" target="_blank" rel="noopener noreferrer"></a><small class="audio-meta">Audio attachment</small></div></div><div class="audio-controls"><button class="audio-play" aria-label="Play audio">▶</button><span class="audio-time">0:00 / –:–</span><input class="audio-seek" aria-label="Seek audio" type="range" min="0" max="100" value="0" step="0.1" disabled><button class="audio-mute" aria-label="Mute audio">◖))</button><input class="audio-volume" aria-label="Audio volume" type="range" min="0" max="1" value="1" step="0.05"></div>';
    const audio = document.createElement("audio");
    audio.src = source;
    audio.preload = "metadata";
    this.append(audio);
    this.player = audio;
    const link = this.querySelector("a");
    link.href = source;
    link.textContent = this.getAttribute("filename") || "Audio attachment";
    const play = this.querySelector(".audio-play"),
      seek = this.querySelector(".audio-seek"),
      time = this.querySelector(".audio-time"),
      volume = this.querySelector(".audio-volume"),
      mute = this.querySelector(".audio-mute"),
      meta = this.querySelector(".audio-meta");
    const bytes = Number(this.getAttribute("bytes"));
    if (bytes > 0)
      meta.textContent =
        bytes >= 1048576
          ? (bytes / 1048576).toFixed(2) + " MB"
          : (bytes / 1024).toFixed(2) + " KB";
    const fmt = (t) =>
      Number.isFinite(t)
        ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`
        : "–:–";
    const update = () => {
      time.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
      seek.disabled = !Number.isFinite(audio.duration) || audio.duration <= 0;
      if (!seek.disabled)
        seek.value = String((audio.currentTime / audio.duration) * 100);
      seek.style.setProperty("--played", `${seek.value}%`);
      seek.setAttribute(
        "aria-valuetext",
        `${fmt(audio.currentTime)} of ${fmt(audio.duration)}`,
      );
      play.textContent = audio.paused ? "▶" : "Ⅱ";
      play.setAttribute(
        "aria-label",
        audio.paused ? "Play audio" : "Pause audio",
      );
    };
    play.onclick = async () => {
      if (audio.paused) {
        try {
          await audio.play();
        } catch {
          meta.textContent =
            "Unable to play this audio. You can download the file above.";
        }
      } else audio.pause();
    };
    seek.oninput = () => {
      if (Number.isFinite(audio.duration))
        audio.currentTime = (Number(seek.value) / 100) * audio.duration;
      update();
    };
    volume.oninput = () => {
      audio.volume = Number(volume.value);
      audio.muted = false;
      mute.textContent = "◖))";
      mute.setAttribute("aria-label", "Mute audio");
    };
    mute.onclick = () => {
      audio.muted = !audio.muted;
      mute.textContent = audio.muted ? "×" : "◖))";
      mute.setAttribute(
        "aria-label",
        audio.muted ? "Unmute audio" : "Mute audio",
      );
    };
    for (const event of [
      "loadedmetadata",
      "durationchange",
      "timeupdate",
      "play",
      "pause",
      "ended",
    ])
      audio.addEventListener(event, update);
    audio.addEventListener("play", () => {
      document.querySelectorAll("audio").forEach((other) => {
        if (other !== audio) other.pause();
      });
    });
    audio.addEventListener("error", () => {
      meta.textContent = "Audio unavailable — try downloading it.";
      play.disabled = true;
    });
  }
  disconnectedCallback() {
    queueMicrotask(() => {
      if (!this.isConnected) this.player?.pause();
    });
  }
}
customElements.define("chat-audio", ChatAudio);
