/**
 * This file is part of the Traliant LMS application.
 */

var oneTimeCheck = 0;

// Stores Traliant tracking API call data made before Traliant custom state data is loaded.
var traliantApiQueue = [];

// Used by in-course JS to open get policy document URL.
var playerHost = 'https://lms.traliant.com';

// Used by in-course JS to open get policy document URL.
var mainWindowURLParams;

// Store list of player variable names and whether they exist. See playerVariableExists(string).
var playerVariableExistsCache = {};


function callAPI(eventname, eventtype, eventdata) {
    if (!isTraliantLMS()) {
        return;
    } else if (!isTraliantInitialized() && traliantApiQueue.length < 5) {
        traliantApiQueue.push({
            eventname: eventname,
            eventtype: eventtype,
            eventdata: eventdata,
        });
        return;
    }

    var parameters = parseUrlParameters();
    var scoId = parameters.scoId;
    var setid = parameters.setId;
    var sesskey = parameters.sessKey;
    var sessionId = parameters.sessionId;
    var trackingServer = parameters.trackingServer;
    var eventsource = 'Storyline';

    // Update variables used by in-course JS.
    window.playerHost = trackingServer.replace('/tracking', '');
    window.mainWindowURLParams = window.location.search.substr(1);

    var eventurl = trackingServer + '/api/sessionevents.php?sessionid=' + encodeURI(sessionId) + '&eventname=' + encodeURI(eventname) + '&eventtype=' + encodeURI(eventtype) + '&eventsource=' + encodeURI(eventsource) + '&eventdata=' + encodeURI(eventdata) + '&sesskey=' + encodeURI(sesskey) + '&scoid=' + encodeURI(scoId) + '&setid=' + encodeURI(setid);

    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function () {
        var eventresponse = '';
        var eventstatus;

        if (xhttp.readyState == 4 && xhttp.status == 200) {
            eventresponse = xhttp.responseText;
            if (eventresponse.indexOf('Success') > 0) {
                eventstatus = 1;
            } else {
                eventstatus = 2;
            }
        } else if (xhttp.readyState == 4 && xhttp.status == 401) {
            eventresponse = JSON.parse(xhttp.responseText);
            try {
                window.parent.parent.location.href = trackingServer + '/html/index.php?error_code=' + eventresponse.Code;
            } catch (e) {
                console.error('Error in handling sessionevents response', e);
            }
        }
    };

    xhttp.open('GET', eventurl, true);
    xhttp.send();
}

function updateProgressBar() {
    if (!isTraliantInitialized()) {
        return;
    }

    // Set to the maximum possible number of scenes in a course.
    var maxScenes = 20;

    var mostSlides = Number(getPlayerVar('MostSlides'));
    var totalParts = getPlayerVar('Total_Parts', 1);
    var completedParts = getPlayerVar('Completed_Parts', 0);

    var totalSlides = 0;
    var currentScene = Math.floor(mostSlides);

    // Add 1 to completed slides because SL draws progress bar, then calls this function.
    // The displayed progress bar is always lagging behind the state variable. See TL-1350.
    var completedSlides = getSlideCount(mostSlides) + 1;

    if (totalParts == 1) {
        // For one part, total up all the available slide counts for each scene.
        for (var i = 1; i <= maxScenes; i++) {
            var sceneSlideCount = getSceneSlideCount(i);

            if (!sceneSlideCount) break;

            totalSlides += sceneSlideCount;

            // If scene number is less than current scene number user is in,
            // user must have finished scene - add slide count to completed count.
            if (i < currentScene) {
                completedSlides += sceneSlideCount;
            }
        }
    } else {
        // For multi-part, assume this part only contains the current scene the user is in.
        totalSlides = getSceneSlideCount(currentScene);
    }

    // Divide by 0 check.
    if (totalSlides == 0) return;

    // For third party LMS, progress bar always goes 0 - 100.
    // For Traliant LMS, progress bar uses total parts count.
    var barSegments = getPlayerVar('TraliantLMS') ? totalParts : 1;

    var thisPartProgress = completedSlides / totalSlides;
    var partSize = 100 / barSegments;
    var prefilledSize = completedParts * partSize;
    var thisPartSize = partSize * thisPartProgress;
    var totalProgress = prefilledSize + thisPartSize;
    totalProgress = Math.min(100, Math.floor(totalProgress / 5) * 5); // Storyline progressbar states are in increments of 5.

    var player = GetPlayer();
    player.SetVar('Progress', totalProgress);
}

/**
 * Get the last slide number for the given scene.
 */
function getSceneSlideCount(sceneNumber) {
    var lastSlide = Number(getPlayerVar('LastSlideScene' + sceneNumber));
    return getSlideCount(lastSlide);
}

/**
 * Get the count of slides from a given slide number.
 *
 * Slide numbers are in the format <scene number>.<slide count>
 *
 * Examples:
 *  getSlideCount(8.26); // 26.
 *  getSlideCount(2.1); // 10.
 */
function getSlideCount(slideNumber) {
    return Math.round(slideNumber * 100) - (Math.floor(slideNumber) * 100);
}

function doOneTimeCheck() {
    window.oneTimeCheck = 1;
}

function playNextPart() {
    if (isTraliantLMS()) {
        window.parent.postMessage('Traliant.playNext', '*');
    } else {
        console.info('Operation not supported');
    }
}

function playPreviousPart() {
    if (isTraliantLMS()) {
        window.parent.postMessage('Traliant.playPrevious', '*');
    } else {
        console.info('Operation not supported');
    }
}

function initTraliantCourse() {
    if (isTraliantInitialized()) {
        return;
    }

    if (isTraliantLMS()) {
        loadTraliantState();
    } else if (playerVariableExists('TraliantLMS')) {
        var player = GetPlayer();
        player.SetVar('TraliantLMS', false);
    }
}

function loadTraliantState() {
    if (!isTraliantLMS()) {
        return;
    }

    var parameters = parseUrlParameters();
    var setId = parameters.setId;
    var trackingId = setId.substring(0, setId.indexOf('_'));
    var trackingServer = parameters.trackingServer;
    var apiUrl = trackingServer.substring(0, trackingServer.indexOf('/tracking'));
    var stateUrl = apiUrl + '/api/v2/trackingid/' + encodeURI(trackingId) + '/course-state';
    var player = GetPlayer();

    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function () {
        if (xhttp.readyState == 4 && xhttp.status == 200) {
            data = JSON.parse(xhttp.responseText).data;

            player.SetVar('Quiz_Points', data.last_quiz_points);
            player.SetVar('ResumeQuiz_Points', data.last_quiz_points);
            player.SetVar('Completed_Parts', data.completed_parts);
            player.SetVar('Total_Parts', data.total_parts);
            player.SetVar('TraliantLMS', true);

            processTraliantApiQueue();
            updateProgressBar();
        }
    };

    xhttp.open('GET', stateUrl, true);
    xhttp.send();
}

function processTraliantApiQueue() {
    var player = GetPlayer();
    var score = parseInt(player.GetVar('Quiz_Points'), 10) || 0;
    var regex = /(score"?:\s*)(\d+)/;

    while (data = traliantApiQueue.shift()) {
        var matches = regex.exec(data.eventdata);
        if (matches) {
            var dataScore = parseInt(matches[2], 10) || 0;
            var newScore = score + dataScore;
            data.eventdata = data.eventdata.replace(regex, '$1' + newScore)
        }

        callAPI(data.eventname, data.eventtype, data.eventdata);
    }
}

function isTraliantInitialized() {
    var player = GetPlayer();

    return playerVariableExists('TraliantLMS')
        ? player.GetVar('TraliantLMS') === isTraliantLMS()
        : true;
}

/**
 * Get a course player variable value or a default if it does not exist.
 */
function getPlayerVar(name, defaultValue) {
    defaultValue = defaultValue || null;
    var player = GetPlayer();

    return playerVariableExists(name)
        ? player.GetVar(name)
        : defaultValue;
}

/**
 * Check if a course variables exists.
 *
 * Only checks for a course variable once to reduce warnings in browser console.
 */
function playerVariableExists(name) {
    if (!window.playerVariableExistsCache.hasOwnProperty(name)) {
        var player = GetPlayer();
        window.playerVariableExistsCache[name] = player.GetVar(name) !== null;
    }

    return window.playerVariableExistsCache[name];
}

function isTraliantLMS() {
    return !!(getUrlParameter('trackingserver') || getFlashUrlParameter('trackingserver'));
}

function getUrlParameter(name) {
    return decodeURIComponent((new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.search) || [null, ''])[1].replace(/\+/g, '%20')) || null;
}

function getFlashUrlParameter(name) {
    return decodeURIComponent((new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(document.referrer) || [null, ''])[1].replace(/\+/g, '%20')) || null;
}

function parseUrlParameters() {
    var sessionId = getUrlParameter('sessionid');
    var sessKey = getUrlParameter('sesskey');
    var scoId = getUrlParameter('scoid');
    var setId = getUrlParameter('setid');
    var trackingServer = getUrlParameter('trackingserver');

    if (!trackingServer) {
        sessionId = getFlashUrlParameter('sessionid');
        sessKey = getFlashUrlParameter('sesskey');
        scoId = getFlashUrlParameter('scoid');
        setId = getFlashUrlParameter('setid');
        trackingServer = getFlashUrlParameter('trackingserver');
    }

    return {
        'sessionId': sessionId,
        'sessKey': sessKey,
        'scoId': scoId,
        'setId': setId,
        'trackingServer': trackingServer
    };
}