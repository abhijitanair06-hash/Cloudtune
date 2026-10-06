const API_URL = "http://127.0.0.1:8000";

const loginScreen = document.getElementById("login-screen");
const musicApp = document.getElementById("music-app");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");

const loginMessage = document.getElementById("login-message");

const searchInput = document.getElementById("search-input");

const songList = document.getElementById("song-list");
const audioPlayer = document.getElementById("audio-player");

const nowPlaying = document.getElementById("now-playing");
const nowArtist = document.getElementById("now-artist");

const playerCover =
    document.getElementById("player-cover");

const playerCoverPlaceholder =
    document.getElementById("player-cover-placeholder");

const playPauseButton =
    document.getElementById("play-pause-button");

const previousButton =
    document.getElementById("previous-button");

const nextButton =
    document.getElementById("next-button");


/* ============================================================
   UPLOAD ELEMENTS
   ============================================================ */

const uploadTitle =
    document.getElementById("upload-title");

const uploadArtist =
    document.getElementById("upload-artist");

const uploadAlbum =
    document.getElementById("upload-album");

const uploadGenre =
    document.getElementById("upload-genre");

const uploadFile =
    document.getElementById("upload-file");

const uploadCover =
    document.getElementById("upload-cover");

const uploadButton =
    document.getElementById("upload-button");

const uploadMessage =
    document.getElementById("upload-message");


/* ============================================================
   PLAYER STATE
   ============================================================ */

let songs = [];
let currentSongIndex = -1;
let currentSongTime = 0;


/* ============================================================
   LOGIN
   ============================================================ */

loginButton.addEventListener("click", login);


async function login() {

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {

        loginMessage.textContent =
            "Please enter username and password.";

        return;
    }

    loginMessage.textContent =
        "Logging in...";

    try {

        const response = await fetch(
            `${API_URL}/api/auth/login`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    username: username,
                    password: password
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {

            throw new Error(
                data.detail || "Login failed"
            );
        }

        localStorage.setItem(
            "cloudtune_token",
            data.access_token
        );

        loginMessage.textContent = "";

        showMusicApp();

    } catch (error) {

        console.error(error);

        loginMessage.textContent =
            "❌ Invalid username or password.";
    }
}


/* ============================================================
   SHOW MUSIC APP
   ============================================================ */

function showMusicApp() {

    loginScreen.style.display = "none";

    musicApp.style.display = "block";

    loadSongs();
}


/* ============================================================
   LOGOUT
   ============================================================ */

logoutButton.addEventListener("click", logout);


function logout() {

    localStorage.removeItem(
        "cloudtune_token"
    );

    audioPlayer.pause();

    audioPlayer.src = "";

    currentSongIndex = -1;

    currentSongTime = 0;

    musicApp.style.display = "none";

    loginScreen.style.display = "flex";

    usernameInput.value = "";
    passwordInput.value = "";

    loginMessage.textContent = "";
}


/* ============================================================
   LOAD SONGS
   ============================================================ */

async function loadSongs() {

    try {

        const response = await fetch(
            `${API_URL}/api/songs/`
        );

        if (!response.ok) {

            throw new Error(
                "Could not load songs"
            );
        }

        songs = await response.json();

        displaySongs(songs);

        await restoreLastSong();

    } catch (error) {

        console.error(error);

        songList.innerHTML =
            "<p>❌ Could not load songs.</p>";
    }
}


/* ============================================================
   RESTORE LAST PLAYED SONG
   ============================================================ */

async function restoreLastSong() {

    const savedSongId =
        localStorage.getItem(
            "cloudtune_song_id"
        );

    const savedTime =
        parseFloat(
            localStorage.getItem(
                "cloudtune_song_time"
            )
        );


    if (!savedSongId || isNaN(savedTime)) {
        return;
    }


    const songIndex =
        songs.findIndex(
            song =>
                String(song.id) ===
                String(savedSongId)
        );


    if (songIndex === -1) {
        return;
    }


    const song =
        songs[songIndex];

    currentSongIndex =
        songIndex;

    currentSongTime =
        savedTime;


    nowPlaying.textContent =
        song.title;

    nowArtist.textContent =
        song.artist;


    /* --------------------------------------------------------
       RESTORE COVER
       -------------------------------------------------------- */

    if (song.cover_url) {

        playerCover.src =
            song.cover_url;

        playerCover.style.display =
            "block";

        playerCoverPlaceholder.style.display =
            "none";

    } else {

        playerCover.src = "";

        playerCover.style.display =
            "none";

        playerCoverPlaceholder.style.display =
            "block";
    }


    try {

        const response = await fetch(
            `${API_URL}/api/songs/${song.id}/stream`
        );


        if (!response.ok) {
            return;
        }


        const data =
            await response.json();


        audioPlayer.src =
            data.stream_url;


        audioPlayer.addEventListener(
            "loadedmetadata",
            function restoreTime() {

                if (
                    currentSongTime > 0 &&
                    currentSongTime <
                    audioPlayer.duration
                ) {

                    audioPlayer.currentTime =
                        currentSongTime;
                }

                audioPlayer.removeEventListener(
                    "loadedmetadata",
                    restoreTime
                );
            }
        );


        playPauseButton.textContent =
            "▶️ Play";


    } catch (error) {

        console.error(
            "Could not restore last song:",
            error
        );
    }
}


/* ============================================================
   DISPLAY SONGS
   ============================================================ */

function displaySongs(songArray) {

    songList.innerHTML = "";

    if (songArray.length === 0) {

        songList.innerHTML =
            "<p>🔍 No songs found.</p>";

        return;
    }

    songArray.forEach(song => {

        const songElement =
            document.createElement("div");

        songElement.className = "song";


        /* ----------------------------------------------------
           ALBUM ART
           ---------------------------------------------------- */

        let coverHTML = `
            <div class="song-cover-placeholder">
                🎵
            </div>
        `;

        if (song.cover_url) {

            coverHTML = `
                <img
                    class="song-cover"
                    src="${song.cover_url}"
                    alt="${song.title} cover"
                >
            `;
        }


        /* ----------------------------------------------------
           SONG CARD
           ---------------------------------------------------- */

        songElement.innerHTML = `

            ${coverHTML}

            <div class="song-details">

                <div class="song-title">
                    ${song.title}
                </div>

                <div class="song-artist">
                    ${song.artist}
                </div>

            </div>
        `;


        const originalIndex =
            songs.findIndex(
                item => item.id === song.id
            );


        songElement.addEventListener(
            "click",
            () => playSong(originalIndex)
        );


        songList.appendChild(songElement);
    });
}


/* ============================================================
   SEARCH
   ============================================================ */

searchInput.addEventListener(
    "input",
    () => {

        const searchText =
            searchInput.value
                .trim()
                .toLowerCase();

        if (!searchText) {

            displaySongs(songs);

            return;
        }

        const filteredSongs =
            songs.filter(song => {

                const title =
                    (song.title || "")
                        .toLowerCase();

                const artist =
                    (song.artist || "")
                        .toLowerCase();

                const album =
                    (song.album || "")
                        .toLowerCase();

                const genre =
                    (song.genre || "")
                        .toLowerCase();

                return (
                    title.includes(searchText) ||
                    artist.includes(searchText) ||
                    album.includes(searchText) ||
                    genre.includes(searchText)
                );
            });

        displaySongs(filteredSongs);
    }
);


/* ============================================================
   UPLOAD SONG
   ============================================================ */

uploadButton.addEventListener(
    "click",
    uploadSong
);


async function uploadSong() {

    const title =
        uploadTitle.value.trim();

    const artist =
        uploadArtist.value.trim();

    const album =
        uploadAlbum.value.trim();

    const genre =
        uploadGenre.value.trim();

    const file =
        uploadFile.files[0];

    const cover =
        uploadCover.files[0];


    /* --------------------------------------------------------
       VALIDATION
       -------------------------------------------------------- */

    if (!title || !artist || !file) {

        uploadMessage.textContent =
            "❌ Title, artist and MP3 file are required.";

        return;
    }


    if (!file.name.toLowerCase().endsWith(".mp3")) {

        uploadMessage.textContent =
            "❌ Only MP3 files are allowed.";

        return;
    }


    if (cover) {

        const validCover =
            /\.(jpg|jpeg|png|webp)$/i.test(
                cover.name
            );

        if (!validCover) {

            uploadMessage.textContent =
                "❌ Cover must be JPG, PNG or WEBP.";

            return;
        }
    }


    /* --------------------------------------------------------
       FORM DATA
       -------------------------------------------------------- */

    const formData =
        new FormData();

    formData.append(
        "title",
        title
    );

    formData.append(
        "artist",
        artist
    );

    formData.append(
        "album",
        album
    );

    formData.append(
        "genre",
        genre
    );

    formData.append(
        "file",
        file
    );

    if (cover) {

        formData.append(
            "cover",
            cover
        );
    }


    uploadMessage.textContent =
        "☁️ Uploading...";

    uploadButton.disabled = true;


    try {

        const token =
            localStorage.getItem(
                "cloudtune_token"
            );


        const response =
            await fetch(
                `${API_URL}/api/songs/upload`,
                {
                    method: "POST",

                    headers: {
                        "Authorization":
                            `Bearer ${token}`
                    },

                    body: formData
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.detail ||
                "Upload failed"
            );
        }


        uploadMessage.textContent =
            "✅ Song uploaded successfully!";


        uploadTitle.value = "";
        uploadArtist.value = "";
        uploadAlbum.value = "";
        uploadGenre.value = "";
        uploadFile.value = "";
        uploadCover.value = "";


        await loadSongs();


    } catch (error) {

        console.error(error);

        uploadMessage.textContent =
            `❌ ${error.message}`;

    } finally {

        uploadButton.disabled = false;
    }
}


/* ============================================================
   PLAY SONG
   ============================================================ */

async function playSong(index) {

    if (index < 0 || index >= songs.length) {
        return;
    }

    const song = songs[index];

    currentSongIndex = index;

    currentSongTime = 0;


    try {

        nowPlaying.textContent =
            song.title;

        nowArtist.textContent =
            song.artist;


        /* ----------------------------------------------------
           PLAYER COVER
           ---------------------------------------------------- */

        if (song.cover_url) {

            playerCover.src =
                song.cover_url;

            playerCover.style.display =
                "block";

            playerCoverPlaceholder.style.display =
                "none";

        } else {

            playerCover.src = "";

            playerCover.style.display =
                "none";

            playerCoverPlaceholder.style.display =
                "block";
        }


        playPauseButton.textContent =
            "⏳ Loading...";


        const response = await fetch(
            `${API_URL}/api/songs/${song.id}/stream`
        );


        if (!response.ok) {

            throw new Error(
                "Could not get streaming URL"
            );
        }


        const data =
            await response.json();


        audioPlayer.src =
            data.stream_url;


        await audioPlayer.play();


        playPauseButton.textContent =
            "⏸️ Pause";


    } catch (error) {

        console.error(error);

        nowPlaying.textContent =
            "❌ Playback failed";

        nowArtist.textContent = "";

        playPauseButton.textContent =
            "▶️ Play";
    }
}


/* ============================================================
   PLAY / PAUSE
   ============================================================ */

playPauseButton.addEventListener(
    "click",
    async () => {

        if (!audioPlayer.src) {

            if (songs.length > 0) {

                await playSong(0);
            }

            return;
        }

        if (audioPlayer.paused) {

            await audioPlayer.play();

        } else {

            audioPlayer.pause();
        }
    }
);


/* ============================================================
   PREVIOUS SONG
   ============================================================ */

previousButton.addEventListener(
    "click",
    async () => {

        if (songs.length === 0) {
            return;
        }

        if (currentSongIndex <= 0) {

            await playSong(
                songs.length - 1
            );

        } else {

            await playSong(
                currentSongIndex - 1
            );
        }
    }
);


/* ============================================================
   NEXT SONG
   ============================================================ */

nextButton.addEventListener(
    "click",
    async () => {

        if (songs.length === 0) {
            return;
        }

        if (currentSongIndex >= songs.length - 1) {

            await playSong(0);

        } else {

            await playSong(
                currentSongIndex + 1
            );
        }
    }
);


/* ============================================================
   AUDIO EVENTS
   ============================================================ */

audioPlayer.addEventListener(
    "play",
    () => {

        playPauseButton.textContent =
            "⏸️ Pause";
    }
);


audioPlayer.addEventListener(
    "pause",
    () => {

        playPauseButton.textContent =
            "▶️ Play";
    }
);


/* ============================================================
   SAVE PLAYBACK POSITION
   ============================================================ */

audioPlayer.addEventListener(
    "timeupdate",
    () => {

        if (currentSongIndex >= 0) {

            currentSongTime =
                audioPlayer.currentTime;

            localStorage.setItem(
                "cloudtune_song_id",
                songs[currentSongIndex].id
            );

            localStorage.setItem(
                "cloudtune_song_time",
                currentSongTime
            );
        }
    }
);


/* ============================================================
   AUTO NEXT SONG
   ============================================================ */

audioPlayer.addEventListener(
    "ended",
    async () => {

        if (songs.length === 0) {
            return;
        }

        if (currentSongIndex >= songs.length - 1) {

            await playSong(0);

        } else {

            await playSong(
                currentSongIndex + 1
            );
        }
    }
);


/* ============================================================
   CHECK EXISTING LOGIN
   ============================================================ */

const savedToken =
    localStorage.getItem(
        "cloudtune_token"
    );

if (savedToken) {

    showMusicApp();
}