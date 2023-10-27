import VideoProcessor from "./videoProcessor.js";
import MP4Demuxer from "./mp4Demuxer.js";
import CanvasRenderer from "./canvasRenderer.js";


const resolutionConstraints = {
    "240p": {
        width: 320,
        height: 240 
    },
    "480p": {
        width: 640,
        height: 480 
    },
    "720p": {
        width: 1280,
        height: 720 
    }
}

const encodeConfig = {
    ...resolutionConstraints['240p'],
    bitrate: 10e6,
    codec: 'vp09.00.10.08',
    pt: 4,
    hardwareAcceleration: 'prefer-software'
    // formats: {
    //     "mp4":{
    //         codec: 'avc1.42002A',
    //         pt: 1,
    //         hardwareAcceleration: 'prefer-hardware',
    //         avc: {format: 'annexb'}
    //     }
    // }
}

const mp4Demuxer = new MP4Demuxer();
const videoProcessor = new VideoProcessor({
    mp4Demuxer
});

onmessage = async ({data}) =>{

    const renderFrame = CanvasRenderer.getRenderer(data.canvas);

    await videoProcessor.start({
        file: data.file,
        encodeConfig: encodeConfig,
        renderFrame: renderFrame
    })

    self.postMessage({
        status: 'done'
    });
}