var usage = {},
    common = require('./../../utils/common.js'),
    dbonoff = require('./../../utils/dbonoff.js'),
    geoip = require('geoip-lite'),
    time = require('time')(Date);
var process = require('process');

(function (usage) {

    var predefinedMetrics = [
        { db: "devices", metrics: [{ name: "_device", set: "devices"}] },
        { db: "carriers", metrics: [{ name: "_carrier", set: "carriers"}] },
        { db: "device_details", metrics: [{ name: "_os", set: "os"}, 
            { name: "_os_version", set: "os_versions"}, 
            { name: "_resolution", set: "resolutions" }] },
        { db: "app_versions", metrics: [{ name: "_app_version", set: "app_versions"}] }
    ];
    var OP_DECREASE=0;
    var OP_FILL=1;
    var OP_INCREASE=2;


    //query user data and execute processUserSession
    usage.processSession = function (apps) {
	//console.log('in session');
	dbonoff.on('raw');

	var _curr_app_user = apps[0].app_user_id;
    	var _curr_idx = 0;
	var dataBag={};

	dataBag = clearBag();
    	for (var i=0; i<apps.length; i++) {
            if (apps[i].app_user_id != _curr_app_user) {
		console.log('loglist='+_curr_idx+':'+i);
		dataBag.apps = apps.slice(_curr_idx, i);
		startSession(dataBag);
		dataBag = clearBag();
		_curr_idx = i;
		_curr_app_user = apps[_curr_idx].app_user_id;
	    }
	}

	if (!_curr_idx) {
	    dataBag.apps = apps;
		console.log('loglist='+_curr_idx+':'+i);
	} else {
	    dataBag.apps = apps.slice(_curr_idx);
		console.log('loglist='+_curr_idx);
	}
	startSession(dataBag);
    }

    function clearBag() {
	var dataBag = {};
	dataBag.apps = [];
    	dataBag.updateSessions = {};
    	dataBag.updateLocations = {};
    	dataBag.updateUsers = {};
    	dataBag.updateCities = {};
    	dataBag.userRanges = {};
    	dataBag.sessionRanges = {};
    	dataBag.countryArray = {};
    	dataBag.cityArray = {};
    	dataBag.userProps = {};
    	dataBag.updateMetrics = {};
    	dataBag.MetricMetaSet = {};
	dataBag.userRanges['meta.f-ranges'] = {};
	dataBag.userRanges['meta.l-ranges'] = {};
	dataBag.sessionRanges['meta.d-ranges'] = {};
	dataBag.userRanges['meta.f-ranges']['$each'] = [];
	dataBag.userRanges['meta.l-ranges']['$each'] = [];
	dataBag.sessionRanges['meta.d-ranges']['$each'] = [];
	dataBag.countryArray['meta.countries'] = {};
	dataBag.cityArray['meta.cities'] = {};
	dataBag.countryArray['meta.countries']['$each'] = [];
	dataBag.cityArray['meta.cities']['$each'] = [];
	return dataBag;
    }
 
    function startSession(dataBag) {
       	common.db.collection('app_users' + dataBag.apps[0].app_id).findOne({'_id': dataBag.apps[0].app_user_id}, 
       	    function (err, dbAppUser){
               	processUserSession(dbAppUser, dataBag);
       	});
    }


    function dbCallback(err, object) {
       	if (err){
            console.log(errHeader+':'+err);  
       	}
	dbonoff.on('raw');
    }

    function durationRange(totalSessionDuration) {
        var durationRanges = [
            [0,10],
            [11,30],
            [31,60],
            [61,180],
            [181,600],
            [601,1800],
            [1801,3600]
        ];
        var durationMax = 3601;
        var calculatedDurationRange;

        if (totalSessionDuration >= durationMax) {
            //calculatedDurationRange = (durationRanges.length) + '';
            calculatedDurationRange = durationRanges.length;
        } else {
            for (var i=0; i < durationRanges.length; i++) {
                if (totalSessionDuration <= durationRanges[i][1] && totalSessionDuration >= durationRanges[i][0]) {
                    //calculatedDurationRange = i + '';
                    calculatedDurationRange = i;
                    break;
                }
            }
        }

        return calculatedDurationRange;
    }

    function updateSessionDuration(dataBag, sessionObj, toFill) {
        var session_duration = sessionObj.acc_duration;
        var updateTimeObject = getTimeFunction(toFill);
	var thisDurationRange = durationRange(session_duration);
        updateTimeObject(sessionObj, dataBag.updateSessions, common.dbMap['durations'] + '.' + thisDurationRange);
        if (common.config.api.session_duration_limit && session_duration > common.config.api.session_duration_limit) {
                session_duration = common.config.api.session_duration_limit;
        }
        updateTimeObject(sessionObj, dataBag.updateSessions, common.dbMap['duration'], session_duration);
	if (toFill != OP_DECREASE) {
	    common.arrayAddUniq(dataBag.sessionRanges['meta.d-ranges']['$each'],parseInt(thisDurationRange));
	}
	return dataBag;
    }


    function computeFreqRange(userTime, userLastSeenTimestamp) {
        var sessionFrequency = [
            [0,1],
            [1,24],
            [24,48],
            [48,72],
            [72,96],
            [96,120],
            [120,144],
            [144,168],
            [168,192],
            [192,360],
            [360,744]
        ],
        sessionFrequencyMax = 744;

        if ((userTime - userLastSeenTimestamp) >= (sessionFrequencyMax * 60 * 60)) {
            return sessionFrequency.length + '';
        } else {
            for (var i=0; i < sessionFrequency.length; i++) {
                if ((userTime - userLastSeenTimestamp) < (sessionFrequency[i][1] * 60 * 60) &&
                    (userTime - userLastSeenTimestamp) >= (sessionFrequency[i][0] * 60 * 60)) {
                    return i + '';
                }
            }
        }
        return '';
    }

    function computeLoyaltyRange(userSessionCount) {
        var loyaltyRanges = [
            [0,1],
            [2,2],
            [3,5],
            [6,9],
            [10,19],
            [20,49],
            [50,99],
            [100,499]
        ],
        loyaltyMax = 500;

        if (userSessionCount >= loyaltyMax) {
            return loyaltyRanges.length + '';
        } else {
            for (var i = 0; i < loyaltyRanges.length; i++) {
                if (userSessionCount <= loyaltyRanges[i][1] && userSessionCount >= loyaltyRanges[i][0]) {
                    return i + '';
                }
            }
        }
        return '';
    }


    function updateRangeMeta(ranges, coll, id, app_cnt) {
        common.db.collection(coll).update({'_id': id}, {'$addToSet': ranges}, {'upsert': true}, dbCallback); 
    }

    function updateCollection(collName, id, data, op, errHeader) {
	var opSet = {};
	opSet[op] = data;
        common.db.collection(collName).update({'_id': id}, opSet, {'upsert': true}, dbCallback); 
    }

    function reallyUpdateAll(dataBag, params, app_cnt) {

        updateRangeMeta(dataBag.userRanges, 'users', params.app_id);
        updateCollection('users', params.app_id, dataBag.updateUsers, '$inc', '[updateUsers]');

        updateRangeMeta(dataBag.countryArray, 'locations', params.app_id);
        updateCollection('locations', params.app_id, dataBag.updateLocations, '$inc', '[updateLocations]');
 
        updateRangeMeta(dataBag.sessionRanges, 'sessions', params.app_id);
        updateCollection('sessions', params.app_id, dataBag.updateSessions, '$inc', '[updateSessions]');

        if (common.config.api.city_data !== false) {
            updateRangeMeta(dataBag.cityArray, 'cities', params.app_id);
            updateCollection('cities', params.app_id, dataBag.updateCities, '$inc', '[updateCities]');
        }

        updateCollection('app_users'+params.app_id, params.app_user_id, dataBag.userProps, '$set', '[userProps]'); 

        for (var i=0; i < predefinedMetrics.length; i++) {
            updateRangeMeta(dataBag.MetricMetaSet[predefinedMetrics[i].db], predefinedMetrics[i].db, params.app_id);
            updateCollection(predefinedMetrics[i].db, params.app_id, dataBag.updateMetrics[predefinedMetrics[i].db], '$inc', '[updateMetrics:'+predefinedMetrics[i].db+']');
	}
    }

    function updateFreqRange(dataBag, sessionObj, dbAppUser) {
        // Calculate the frequency range of the user
	//console.log('updateFreqRange:%j', sessionObj);
	//console.log(dbAppUser);
        var calculatedFrequency;
	if (!dbAppUser || !dbAppUser.timestamp) { //new user
            return;
	} else {
            calculatedFrequency = computeFreqRange(sessionObj.timestamp, dbAppUser.timestamp);
	}
        common.fillTimeObject(sessionObj, dataBag.updateUsers, common.dbMap['frequency'] + '.' + calculatedFrequency);
        common.arrayAddUniq(dataBag.userRanges['meta.f-ranges']['$each'],parseInt(calculatedFrequency));
	return dataBag;
    } 

    function updateLoyaltyRange(dataBag, sessionObj, session_count) {
        // Calculate the loyalty range of the user
        var calculatedLoyaltyRange = computeLoyaltyRange(session_count);
        common.fillTimeObject(sessionObj, dataBag.updateUsers, common.dbMap['loyalty'] + '.' + calculatedLoyaltyRange);
	common.arrayAddUniq(dataBag.userRanges['meta.l-ranges']['$each'], parseInt(calculatedLoyaltyRange));
	return dataBag;
    } 
   
    function getTimeFunction(toFill) {
        var updateTimeObject;
        switch (toFill) {
            case OP_INCREASE:
                updateTimeObject = common.incrTimeObject;
                break;
            case OP_DECREASE:
                updateTimeObject = common.decrTimeObject;
                break;
            default:
                updateTimeObject = common.fillTimeObject;
        }
        return updateTimeObject;
    }

    function updateMetricTimeObj(dataBag, sessionObject, prop, toFill) {
	if (!sessionObject.metrics) return; 

        var updateTimeObject = getTimeFunction(toFill);
        for (var i=0; i<predefinedMetrics.length; i++) {
	    var metricDb = predefinedMetrics[i].db;
            for (var j=0; j<predefinedMetrics[i].metrics.length; j++) {
                var tmpMetric = predefinedMetrics[i].metrics[j];
                var recvMetricValue = sessionObject.metrics[tmpMetric.name];

                if (recvMetricValue) {
                    var escapedMetricVal = recvMetricValue.replace(/^\$/, "").replace(/\./g, ":");
                    var metricMeta = 'meta.' + tmpMetric.set;
		    if (!dataBag.MetricMetaSet[metricDb]) {
			dataBag.MetricMetaSet[metricDb] = {};
		    }
		    if (!dataBag.MetricMetaSet[metricDb][metricMeta]) {
			dataBag.MetricMetaSet[metricDb][metricMeta] = {};
		    }
		    if (!dataBag.MetricMetaSet[metricDb][metricMeta]['$each'] || 
			!dataBag.MetricMetaSet[metricDb][metricMeta]['$each'].length) {
			dataBag.MetricMetaSet[metricDb][metricMeta]['$each'] = [];
		    }
                    common.arrayAddUniq(dataBag.MetricMetaSet[metricDb][metricMeta]['$each'], escapedMetricVal);

		    if (!dataBag.updateMetrics[metricDb]) {
			dataBag.updateMetrics[metricDb] = {};
	            }	
                    updateTimeObject(sessionObject, dataBag.updateMetrics[metricDb], escapedMetricVal + '.' + prop);
                }
            }
        }
//	console.log('in update Metric');
//	console.log(dataBag.updateMetrics['devices']);
	return dataBag;
    }

    function updateStatistics(dataBag, sessionObject, prop, toFill, increase) {
        var incr = increase? increase : 1;
        var updateTimeObject = getTimeFunction(toFill);
        updateTimeObject(sessionObject, dataBag.updateSessions, prop, incr);
        updateTimeObject(sessionObject, dataBag.updateLocations, sessionObject.country + '.' + prop, incr);
        common.arrayAddUniq(dataBag.countryArray['meta.countries']['$each'], sessionObject.country);
        if (common.config.api.city_data !== false) {
            updateTimeObject(sessionObject, dataBag.updateCities, sessionObject.city + '.' + prop, incr);
            common.arrayAddUniq(dataBag.cityArray['meta.cities']['$each'], sessionObject.city);
        }
	updateMetricTimeObj(dataBag, sessionObject, prop, toFill);
//	console.log('after update Metric');
//	console.log(dataBag.updateMetrics['devices']);
	return dataBag;
    }

/*
    function updateUserMetric(dataBag, sessionObject) {
	if (!sessionObject.metrics) return;

        for (var i=0; i<predefinedMetrics.length; i++) {
            for (var j=0; j<predefinedMetrics[i].metrics.length; j++) {
                var tmpMetric = predefinedMetrics[i].metrics[j],
                    recvMetricValue = sessionObject.metrics[tmpMetric.name];

                if (recvMetricValue) {
                    var escapedMetricVal = recvMetricValue.replace(/^\$/, "").replace(/\./g, ":");
                    if (tmpMetric.short_code) {
                        dataBag.userProps[tmpMetric.name] = escapedMetricVal;
                    }
                }
            }
        }
	return dataBag;
    }
*/

    function updateUserProfile(dataBag, sessionObject, finalUserObject) {
        //updateUserMetric(sessionObject);
        dataBag.userProps[common.dbUserMap['device_id']] = sessionObject.device_id;
        dataBag.userProps[common.dbUserMap['session_duration']] = parseInt(sessionObject.acc_duration);
        dataBag.userProps[common.dbUserMap['total_session_duration']] = parseInt(finalUserObject[common.dbUserMap['total_session_duration']]);
        dataBag.userProps[common.dbUserMap['session_count']] = finalUserObject[common.dbUserMap['session_count']];
        dataBag.userProps[common.dbUserMap['last_end_session_timestamp']] = finalUserObject[common.dbUserMap['last_end_session_timestamp']];
        dataBag.userProps.metrics = sessionObject.metrics;
        dataBag.userProps.appTimezone = sessionObject.appTimezone;
        dataBag.userProps.timestamp = sessionObject.timestamp;
        dataBag.userProps.tz = sessionObject.tz;
        dataBag.userProps.time = sessionObject.time;
        dataBag.userProps.country = sessionObject.country;
        dataBag.userProps.city = sessionObject.city;
        dataBag.userProps.app_id = sessionObject.app_id;
        dataBag.userProps.app_user_id = sessionObject.app_user_id;
	return dataBag;
    }

    //Param: dbAppUser-user data in app_user_XXX, apps:all logs for a Single User
    function processUserSession(dbAppUser, dataBag) {
        var sessionObj = [];
        var last_end_session_timestamp = 0;
        var total_duration = 0;
	var i = 0;
	var normalSessionStart = 0;

	//console.log('process user session length='+dataBag.apps.length);
	//if (dbAppUser) console.log(dbAppUser);
	//else console.log(apps[0]);
        if (dbAppUser) { //set sessionObj[0] = dbAppUser to compute on-going session
	    //console.log('dbAppUser=%j', dbAppUser);
            dbAppUser.acc_duration = parseInt(dbAppUser[common.dbUserMap['session_duration']]);
            sessionObj[0] = common.clone(dbAppUser);
            last_end_session_timestamp = dbAppUser[common.dbUserMap['last_end_session_timestamp']];
        } else { //new user
            sessionObj[0] = {};
	    for (;normalSessionStart<dataBag.apps.length; normalSessionStart++) {
		if (dataBag.apps[normalSessionStart].begin_session) break;
	    }
        }
	if (normalSessionStart >= dataBag.apps.length) { //no begin_session for new user -->for the remaining logs from previous data
	    console.log('Incomplete session data from past users');
	    return;
	}
        /* for boundary condition:
            1. dbAppUser contains begin_session(last_end_session_timestamp=0): 
                end_session will update last_end_session_timestamp, 
                session duration will increase total durations; ongoing begin_session will just continue; 
                new begin_session will init new sessionObj
            2. dbAppUser contains end_session: ongoing begin_session will just continue; 
                new begin_session will init new sessionObj
            3. the last one is begin_session: last_end_session_timestamp = 0; acc_duration = current session_duration
            4. the last one is end_session: last_end_session_timestamp = current timestamp;
                acc_duration = current session_duration
        */
        var currObjIdx = 0;
	console.log('normal start='+normalSessionStart+'; length='+dataBag.apps.length);
        for (i=normalSessionStart; i<dataBag.apps.length; i++) {
	    if (!dataBag.apps[i].timestamp) {
		console.log('no timestamp');
		continue;
	    }
            dataBag.apps[i].time = common.initTimeObj(dataBag.apps[i].appTimezone, dataBag.apps[i].timestamp, dataBag.apps[i].tz);
            //set event(request) count for every request
            common.incrTimeObject(dataBag.apps[i], dataBag.updateSessions, common.dbMap['events']); 
            if (dataBag.apps[i].begin_session) {
//		console.log('dataBag app:'+i+':begin_session');
                if ((dataBag.apps[i].timestamp - last_end_session_timestamp) <= common.config.api.cl_endsession_ongoing_timeout) { //ongoing session
                    last_end_session_timestamp = 0;
                    continue;
                }
                last_end_session_timestamp = 0;
                //init a new sessionObj to keep the session with this begin_session
                sessionObj[++currObjIdx] = dataBag.apps[i];
                sessionObj[currObjIdx].acc_duration = 0;
            }
            if (dataBag.apps[i].end_session) { 
//		console.log('dataBag app:'+i+':end_session');
                //used to judge if there will be ongoing session
                last_end_session_timestamp = dataBag.apps[i].timestamp;
            }
            if (dataBag.apps[i].session_duration) {
//		console.log('dataBag app:'+i+':session_duration');
                sessionObj[currObjIdx].acc_duration += parseInt(dataBag.apps[i].session_duration);
                total_duration += parseInt(dataBag.apps[i].session_duration);
            }
        }

	console.log('sessionObj:'+currObjIdx);
        //Prepare final Session info to update
        var finalUserObject = {};
        finalUserObject[common.dbUserMap['last_end_session_timestamp']] = last_end_session_timestamp;
        finalUserObject[common.dbUserMap['session_count']] = (dbAppUser?dbAppUser[common.dbUserMap['session_count']]:0) + currObjIdx;
        finalUserObject[common.dbUserMap['total_session_duration']] 
            = total_duration + (dbAppUser?parseInt(dbAppUser[common.dbUserMap['total_session_duration']]):0);

        var sessionObjByDay = [];
        var sessionDay = null;
        var sessionDayIdx = -1;
        var startIdx = dbAppUser? 0 : 1;
        var calculatedDurationRange = 0;

        for (i=startIdx; i<=currObjIdx; i++) { 
            if (sessionDay != sessionObj[i].time.daily) { //sort sessions by day
                sessionDay = sessionObj[i].time.daily;
                sessionObjByDay[++sessionDayIdx]= [];                
            }
            sessionObjByDay[sessionDayIdx].push(sessionObj[i]);

	    if (sessionObj[i].acc_duration > 0) { //ignore partial session which has no end_session or session_duration info
                updateSessionDuration(dataBag, sessionObj[i], OP_INCREASE);
	    }

            //set total user/unique user count in necessary collections   
            common.computeGeoInfo(sessionObj[i]);
            updateStatistics(dataBag, sessionObj[i], common.dbMap['total'], OP_INCREASE); //will increase for every session
            updateStatistics(dataBag, sessionObj[i], common.dbMap['unique'], OP_FILL); // only set once
        }
	    console.log('sessionObjByDay='+startIdx+':'+(i-1));
//	    console.log(sessionObjByDay);

	//For frequency computation, no need to do with sessions in the same day as old sessions(dbAppUser)
	//The 1st session will be dealt with in new user block
        for (i=1; i<sessionObjByDay.length; i++) { 
            updateFreqRange(dataBag, sessionObjByDay[i][0], sessionObjByDay[i-1][sessionObjByDay[i-1].length-1]);
	}

        //update loyalty from the 2nd day
        var session_count = dbAppUser?dbAppUser[common.dbUserMap['session_count']]:0;
        for (i=1; i<sessionObjByDay.length; i++) {
            session_count += sessionObjByDay[i-1].length;
            updateLoyaltyRange(dataBag, sessionObjByDay[i][0], session_count);
        }

        //If there is on-going session coming in at first...
        if (dbAppUser) {
            //Update last session in DB to include new session duration sent after last processing, also update duration ranges
            if (dbAppUser.acc_duration>0) {
		updateSessionDuration(dataBag, dbAppUser, OP_DECREASE);
	    }
            updateStatistics(dataBag, dbAppUser, common.dbMap['total'], OP_DECREASE); 
            updateStatistics(dataBag, dbAppUser, common.dbMap['unique'], OP_DECREASE); // reset previous add in sessionObj

        } else { //set new user count in necessary collections   
            updateStatistics(dataBag, sessionObjByDay[0][0], common.dbMap['new']);
            updateLoyaltyRange(dataBag, sessionObjByDay[0][0], 1); //session count = 1
	    updateFreqRange(dataBag, sessionObjByDay[0][0], sessionObjByDay[0][0]); //set 1st session
        }

        //use last session object to update user profiles (metrics)
        updateUserProfile(dataBag, sessionObj[currObjIdx], finalUserObject);

        //do the real update job in MongoDB
        reallyUpdateAll(dataBag, sessionObj[startIdx], dataBag.apps.length);
    }
}(usage));

module.exports = usage;
