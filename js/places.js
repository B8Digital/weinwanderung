// Betriebe und Wegpunkte (Startdaten). Koordinaten werden beim Laden mit OpenStreetMap abgeglichen.
// Tage: 0=So,1=Mo,…,6=Sa. hours: {dow:[[von,bis]]} in Dezimalstunden. Fehlt hours → unbekannt (wird akzeptiert, aber markiert).
const SEED_PLACES = [
 {id:"ehrenhausen",name:"Ehrenhausen Kirchenplatz",kind:"start",tags:["kultur"],lat:46.7268,lon:15.5845,addr:"Kirchenplatz, 8461 Ehrenhausen",note:"Barocke Pfarrkirche, Marktplatz; Ausgangspunkt der Weinwanderwege 1–4"},
 {id:"gamlitz",name:"Gamlitz Marktplatz",kind:"start",tags:["kultur"],lat:46.7225,lon:15.5558,addr:"Marktplatz, 8462 Gamlitz",note:"Weinbaugemeinde, Motorikpark in der Nähe"},
 {id:"ratsch",name:"Ratsch an der Weinstraße",kind:"start",tags:["aussicht"],lat:46.7160,lon:15.5520,addr:"8461 Ratsch an der Weinstraße",note:"Weinwanderweg Ratsch–Ottenberg"},
 {id:"bahnhof",name:"Bahnhof Ehrenhausen",kind:"start",tags:[],lat:46.7275,lon:15.5905,addr:"Bahnhofstraße, 8461 Ehrenhausen",note:"S-Bahn Graz–Spielfeld"},

 {id:"zweytick",name:"Buschenschank Zweytick",kind:"buschenschank",tags:["aussicht","kulinarik"],lat:46.7395,lon:15.5545,addr:"Unterlupitscheni 49, 8461 Ehrenhausen",phone:"+43 664 4414044",web:"zweytick.at",closed:[1,2],hours:{0:[[11,21]],3:[[13,21]],4:[[13,21]],5:[[13,21]],6:[[11,21]]},note:"Liegt am Weinwanderweg Nr. 1; Mo und Di Ruhetag"},
 {id:"perner",name:"Weingut Perner",kind:"buschenschank",tags:["ruhig","kulinarik"],lat:46.7370,lon:15.5600,addr:"Unterlupitscheni 38, 8461 Ehrenhausen",phone:"+43 650 2601732",web:"weingut-perner.at",closed:[4],note:"Abkürzung des Weinwanderwegs Nr. 1; Do Ruhetag"},
 {id:"marko",name:"Weingut Marko",kind:"buschenschank",tags:["aussicht","ruhig"],lat:46.7190,lon:15.5700,addr:"Ottenberg 3, 8461 Ehrenhausen",phone:"+43 664 3949566",web:"marko-weingut.at",note:"Buschenschank nur nach Voranmeldung – vorher anrufen"},
 {id:"uhl",name:"Buschenschank Uhl",kind:"buschenschank",tags:["aussicht","familie"],lat:46.7180,lon:15.5600,addr:"Ratsch 141, 8461 Ehrenhausen",web:"https://www.steiermark.com/de/Suedsteiermark/Urlaub-planen/Ausflugsziele/Buschenschank-Uhl_isd_49970173",closed:[1,2,3,4],hours:{5:[[14,21]],6:[[14,21]],0:[[14,21]]},note:"Direkt am Weinwanderweg Ratsch–Ottenberg, Sonnenterrasse, Spielplatz; Fr–So ab 14 Uhr (Apr–Nov)"},
 {id:"koegl",name:"Buschenschank Kögl",kind:"buschenschank",tags:["aussicht","ruhig","kulinarik"],lat:46.7120,lon:15.5560,addr:"Ratsch 59, 8461 Ehrenhausen",web:"https://www.steiermark.com/de/Suedsteiermark/Urlaub-planen/Ausflugsziele/Buschenschank-Koegl_isd_49970895",closed:[1,2],hours:{3:[[17,21]],4:[[17,21]],5:[[17,21]],6:[[12,21]],0:[[12,21]]},note:"Kalte Jause mit veganen Elementen, Terrasse mit Aussicht; Sa/So ab 12, Mi–Fr ab 17 Uhr (Sep–Okt)"},
 {id:"firmenich",name:"Casa Firmenich (vorm. Steinberghof)",kind:"buschenschank",tags:["kulinarik","aussicht"],lat:46.7150,lon:15.5450,addr:"Eckberg 37, 8462 Gamlitz",note:"Falstaff-gelistet, stilvoll und gemütlich"},
 {id:"hack",name:"Buschenschank Hack-Gebell",kind:"buschenschank",tags:["kultur","kulinarik","familie"],lat:46.7130,lon:15.5420,addr:"Eckberg, 8462 Gamlitz",web:"https://www.falstaff.com/en/winetaverns/weingut-buschenschank-hack-gebell",note:"360 Jahre altes Winzerhaus mit Ziegelgewölbe und Terrasse"},
 {id:"fellner",name:"Buschenschank Fellner",kind:"buschenschank",tags:["ruhig","aussicht"],lat:46.7320,lon:15.5400,addr:"Sernau 25, 8462 Gamlitz",note:"Weingut und Buschenschank in Sernau"},
 {id:"trummer",name:"Buschenschank Trummer am Obegg",kind:"buschenschank",tags:["aussicht","kulinarik"],lat:46.7020,lon:15.5750,addr:"Am Obegg 1, 8472 Spielfeld",note:"Lagen Obegg und Grassnitzberg, außergewöhnliche Lage"},
 {id:"lillijojo",name:"Lilli & Jojo – Das kleine Wirtshaus",kind:"gasthaus",tags:["kulinarik"],lat:46.7050,lon:15.5470,addr:"Sulztal an der Weinstraße 22, 8461 Gamlitz",note:"Warme Küche, Falstaff 93 Punkte"},
 {id:"sattlerhof",name:"Sattlerhof",kind:"gasthaus",tags:["kulinarik","aussicht"],lat:46.7300,lon:15.5380,addr:"Sernau 2, 8462 Gamlitz",note:"Weingut, Restaurant und Hotel"},
 {id:"feinesteirer",name:"Der Feine Steirer by Andrea",kind:"gasthaus",tags:["kulinarik","familie"],lat:46.7170,lon:15.5490,addr:"Ratsch an der Weinstraße 18, 8461 Gamlitz",note:"Wirtshaus in Ratsch"},

 {id:"mausoleum",name:"Mausoleum der Eggenberger",kind:"sight",tags:["kultur","aussicht"],lat:46.7258,lon:15.5815,addr:"Schlossberg, Ehrenhausen",stay:15,note:"Frühbarockes Mausoleum (1609–1689) auf dem Schlossberg, Blick über das Murtal"},
 {id:"schloss",name:"Schloss Ehrenhausen",kind:"sight",tags:["kultur"],lat:46.7250,lon:15.5800,addr:"Am Schlossberg, Ehrenhausen",stay:10,note:"Privatbesitz, nur von außen"},
 {id:"loisium",name:"LOISIUM Wine & Spa",kind:"sight",tags:["kulinarik","kultur"],lat:46.7245,lon:15.5785,addr:"Am Schlossberg 1a, 8461 Ehrenhausen",web:"https://www.loisium.com/suedsteiermark",phone:"+43 3453 28800",stay:20,note:"Weinwelt und Vinothek"},
 {id:"erzjohann",name:"Vinothek Erzherzog Johann Weine",kind:"sight",tags:["kulinarik"],lat:46.7262,lon:15.5790,addr:"Ehrenhausen",stay:20,note:"Verkostung und Weinverkauf am Weg Richtung Gamlitz"},
 {id:"georgi",name:"Schloss Georgi",kind:"sight",tags:["kultur","ruhig"],lat:46.7340,lon:15.5860,addr:"Ehrenhausen",stay:10,note:"Georgischlössl, am Weinwanderweg Nr. 1"},
 {id:"motorik",name:"Motorikpark Gamlitz",kind:"sight",tags:["familie","natur"],lat:46.7245,lon:15.5620,addr:"Gamlitz",stay:30,note:"Europas größter Motorikpark, frei zugänglich"},
 {id:"wasserturm",name:"Wasserturm Gamlitz",kind:"sight",tags:["aussicht"],lat:46.7270,lon:15.5600,addr:"Weinleiten, Gamlitz",stay:10,note:"Aussichtspunkt etwas abseits des Rundwegs Nr. 3"},
 {id:"ottenberg",name:"Ottenberg Aussicht",kind:"sight",tags:["aussicht","natur"],lat:46.7205,lon:15.5680,addr:"Ottenberg",stay:10,note:"Obstgärten und Weinberge, Blick nach Ratsch und Gamlitz"},
 {id:"ratschergraben",name:"Ratschergraben",kind:"sight",tags:["natur","ruhig"],lat:46.7195,lon:15.5580,addr:"Ratsch",stay:5,note:"Waldiger Graben zwischen Ottenberg und Gamlitz"},
 {id:"muehle",name:"Traussner-Mühle",kind:"sight",tags:["natur","kultur","familie"],lat:46.7200,lon:15.5900,addr:"Spielfelder Straße 57, Ehrenhausen",web:"muehlerei.at",phone:"+43 664 4505294",stay:15,note:"Mühle an der Mur, Weinwanderweg Nr. 4"},
 {id:"bergbad",name:"Bergbad Retznei",kind:"sight",tags:["natur","familie"],lat:46.7400,lon:15.5750,addr:"Retznei 66",web:"bergbad.at",phone:"+43 664 1593631",stay:15,note:"Badebuffet, Weinwanderweg Nr. 2"},
 {id:"kranach",name:"Kranachberg Sauvignonweg",kind:"sight",tags:["aussicht","natur"],lat:46.7190,lon:15.5180,addr:"Kranachberg, Gamlitz",stay:10,note:"Themenweg durch die Weinberge"}
];

const WEINMOBIL = {name:"WEINmobil Südsteiermark (Weintaxi)",phone:"+43 3454 94127",phoneRaw:"+43345494127",web:"https://www.weinmobil.at",booking:"https://buchung.regiomobil.st",hint:"Fährt täglich 10:00–23:30 Uhr. Fahrt bitte mindestens 90 Minuten vorher buchen (online oder telefonisch)."};
