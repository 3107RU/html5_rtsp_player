/**
 * Created by wendy on 2017/4/13.
 * 4/14 可以正常播放，但是花屏。。。效果不好啊
 */
var wsserver = new (require('ws').Server)({port:1104});
var net = require('net');
var channelIndex = 1;
wsserver.on("close", function () {
    console.log("close:",conn);
});
var channelsocket = {};
wsserver.on('connection',function(conn) {
    console.log("protocol:",conn.protocol);
    var protocol = conn.protocol;
    if(protocol == "control") {
        conn.onmessage = function (msg) {
            console.log('control:', msg.data);
            var res = wspParse(msg.data);
            if(res.msg == "INIT"){
                var ipIndex = _ip2int(res.data.host);

                    var channel = channelIndex++;
                    conn.channel = channel;
                    InitChannel(channel,ipIndex,res.data.host,res.data.port,function(){
                        var msg = wspMsg("200","INIT OK",res.data.seq,{"channel":channel});
                        conn.send(msg);
                    },function(msgFail){
                        var msg = wspMsg("501",msgFail,res.data.seq);
                        conn.send(msg);
                    });


            }
            else if(res.msg == "WRAP"){
                console.log("wrap send:", res.payload);
                if(channelsocket[conn.channel])
                {
                    channelsocket[conn.channel].on('svrAnswer', data => {
                        console.log("wrap answer:", data)
                        // res.data.seq - недодумка - нельзя совместить res.data.seq и CSeq
                        // мы отправили payload, а на что пришел ответ не знаем
                        // либо должны вести свои CSeq и отслеживать запросы, но тогда теряется смысл прокси
                        // прокси не должен знать протокол
                        // будем надеяться что для запроса WRAP res.data.seq игнорируется плеером и он использует CSeq
                        // для понимания что это за ответ
                        var msg = wspMsg("200", "WRAP OK", res.data.seq, {"channel": conn.channel}, data);
                        conn.send(msg);
                    });
                    channelsocket[conn.channel].write(res.payload);
                }
            }

        }
    }
    else if(protocol == "data"){
        //建立pipe
        conn.onmessage = function (msg) {
            console.log('data:', msg.data);
            var res = wspParse(msg.data);
           if(res.msg == "JOIN") {
               channelsocket[res.data.channel].on('rtpData', function (data) {
                   //console.log(data);
                   conn.send(data);
               });
               var msg = wspMsg("200", "JOIN OK", res.data.seq);
               conn.send(msg);
           }
        }
    }
});
function _ip2int(ip)
{
    var num = 0;
    ip = ip.split(".");
    num = Number(ip[0]) * 256 * 256 * 256 + Number(ip[1]) * 256 * 256 + Number(ip[2]) * 256 + Number(ip[3]);
    num = num >>> 0;
    return num;
}
function InitChannel(channel,ipIndex,ip,prt,okFunc,failFunc){

    var sock =  net.createConnection({
        host:ip,
        port:prt   
    });

    sock.on('connect', () => {
        channelsocket[channel] = sock;
        okFunc();
        sock.connectInfo = true;
    });

    sock.buf = Buffer.alloc(0)
    sock.on('data', data => {
        sock.buf = Buffer.concat([sock.buf, data])

        for (;;) {
            if (sock.buf.length < 1) break
            if (sock.buf[0] == 36) {
                if (sock.buf.length < 4) break
                const len = sock.buf.readUIntBE(2, 2) + 4
                if (sock.buf.length < len) break
                const buf = Buffer.alloc(len)
                sock.buf.copy(buf, 0, 0, len)
                sock.emit("rtpData", buf)
                const buf1 = Buffer.alloc(sock.buf.length - len)
                sock.buf.copy(buf1, 0, len, sock.buf.length)
                sock.buf = buf1
            } else {
                const res = rtspParse(sock.buf)
                if (!res) break
                sock.emit("svrAnswer", sock.buf.toString('utf8', 0, res.len))
                const buf1 = Buffer.alloc(sock.buf.length - res.len)
                sock.buf.copy(buf1, 0, res.len, sock.buf.length)
                sock.buf = buf1
            }
        }
    })

    sock.on('end', () => {
        console.log('disconnected from server');
    });

    sock.on('error',function(e){
        //clean all client;
        console.log('error:', e);
    });

    sock.setTimeout(1000 * 3,function() {
        if(!sock.connectInfo) {
            console.log("time out");
            failFunc("relink host[" + ip + "] time out");
            sock.destroy();
        }
    });

    sock.on('close',function(code){
        //关闭所有子项目

    });
}


function wspParse(data){
    var payIdx = data.indexOf('\r\n\r\n');
    var lines = data.substr(0, payIdx).split('\r\n');
    var hdr = lines.shift().match(new RegExp('WSP/1.1\\s+(.+)'));
    if (hdr) {
        var res = {
            msg:  hdr[1],
            data: {},
            payload: ''
        };
        while (lines.length) {
            var line = lines.shift();
            if (line) {
                var subD = line.split(':');
                res.data[subD[0]] = subD[1].trim();
            } else {
                break;
            }
        }
        res.payload = data.substr(payIdx+4, res.data.contentLength)
        return res;
    }
    return null;
}

function wspMsg(code,msg,seq,data,play){

    var msg = "WSP/1.1 " + code + " " + msg + "\r\n";
    msg += "seq:" + seq ;
    if(data) {
        for (var i in data) {
            msg += "\r\n";
            msg += i.toString() + ":" + data[i].toString();
        }
    }
    msg += "\r\n\r\n";
    if(play)
    msg += play;

    return msg;
}

function rtspParse(buf){
    var payIdx = buf.indexOf('\r\n\r\n')
    if (payIdx < 0) return null
    const data = buf.toString('utf8', 0, payIdx)
    var lines = data.split('\r\n')
    var res = {
        hdr: lines.shift(),
        len: payIdx + 4,
        data: {}
    }
    while (lines.length) {
        var line = lines.shift()
        console.log('lene:', line)
        var subD = line.split(':')
        res.data[subD[0]] = subD[1].trim()
    }
    if (res.data['Content-Length'])
        res.len += parseInt(res.data['Content-Length'])
    return res
}
