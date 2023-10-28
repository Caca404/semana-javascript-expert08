export default class VideoProcessor{

    #mp4Demuxer
    #webMWriter
    #buffers = [];
    #service
    /**
     * 
     * @param {object} options
     * @param {import('./mp4Demuxer.js').default} options.mp4Demuxer 
     * @param {import('../deps/webm-writer2.js').default} options.WebMWriter
     * @param {import('./service.js').default} options.service
     */
    constructor({mp4Demuxer, WebMWriter, service}){
        this.#mp4Demuxer = mp4Demuxer;
        this.#webMWriter = WebMWriter;
        this.#service = service;
    }

    /** @returns {ReadableStream} */
    mp4Decoder(stream){

        return new ReadableStream({
            start: async (controller) => {

                const decoder = new VideoDecoder({
                    /** @param {VideoFrame} frame */
                    output(frame){
                        controller.enqueue(frame);
                    },
                    error(e){
                        console.error('error no mp4Decoder', e);
                        controller.error(e);
                    }
                });
        
                return this.#mp4Demuxer.run(stream,
                    {
                        async onConfig(config) {
                            decoder.configure(config)
                        },
                        /** @param {EncodedVideoChunk} chunk */
                        onChunk(chunk) {
                            decoder.decode(chunk)
                        },
                    }
                )
                // .then(() => {
                //     setTimeout(() => {
                //         controller.close();
                //     }, 1000);
                // })
            }
        });
    }

    encode144p(encodeConfig){

        let _encoder;

        const readable = new ReadableStream({
            start: async (controller) => {
                const {supported} = await VideoEncoder.isConfigSupported(encodeConfig);
                if(!supported){
                    let message = 'mp4Muxer VideoEncoder config not supported';
                    console.error(message, encodeConfig);
                    controller.error(message);
                    return;
                }

                _encoder = new VideoEncoder({
                    /**
                     * 
                     * @param {EncodedVideoChunk} chunk 
                     * @param {EncodedVideoChunkMetadata} config 
                     */
                    output: (chunk, config) => {
                        if(config.decoderConfig){
                            const decoderConfig = {
                                type: 'config',
                                config: config.decoderConfig
                            }
                            controller.enqueue(decoderConfig);
                        }
                        controller.enqueue(chunk);
                    },
                    error: (err) => {
                        console.error('VideoEncoder 144p', err);
                        controller.error(err);
                    }
                });

                await _encoder.configure(encodeConfig);
            }
        });

        const writable = new WritableStream({
            async write(frame){
                _encoder.encode(frame);
                frame.close();
            }
        });



        return {
            readable,
            writable
        };
    }

    renderDecodedFramesAndGetEncodedChunks(renderFrame){
        let _decoder;
        return new TransformStream({
            start: (controller) => {
                _decoder = new VideoDecoder({
                    output(frame){
                        renderFrame(frame);
                    },
                    error(e){
                        console.error('error at renderFrames', e);
                        controller.error(e);
                    }
                });
            },
            /**
             * 
             * @param {EncodedVideoChunk} encodedChunk 
             * @param {TransformStreamDefaultController} controller 
             */
            async transform(encodedChunk, controller){
                if(encodedChunk.type === 'config'){
                    await _decoder.configure(encodedChunk.config);
                    return;
                }

                _decoder.decode(encodedChunk);

                // need the encoded version to use WebM

                controller.enqueue(encodedChunk);
            }
        });
    }

    transformIntoWebM(){
        const writable = new WritableStream({
            write: (chunk) => {
                this.#webMWriter.addFrame(chunk);
            }
        });
        
        return{
            readable: this.#webMWriter.getStream(),
            writable
        }
    }

    upload(filename, resolution, type){
        const chunksGlob = [];
        let byteCount = 0;
        let segmentCount = 0;
        const triggerUpload = async chunks => {
            const blob = new Blob(
                chunks,
                {type: 'video/webm'}
            );

            await this.#service.uploadFile({
                filename: filename+("-"+(++segmentCount))+('-144p.webm'),
                fileBuffer: blob
            });

            chunksGlob.length = 0;
            byteCount = 0;

        }
        return new WritableStream({
            /**
             * @param {object} options
             * @param {Uint8Array} options.data 
             */
            async write({data}){
                chunksGlob.push(data);
                byteCount += data.byteLength;
                // Só faz upload acima de 10 MB
                if(byteCount <= 10e6) return;

                await triggerUpload(chunksGlob);
            },
            async close(){
                if(!chunksGlob.length) return;
                await triggerUpload(chunksGlob);
            }
        });
    }

    async start({file, encodeConfig, renderFrame, sendMessage}){
        const stream = file.stream();
        const fileName = file.name.split('/').pop().replace('.mp4', '');
        await this.mp4Decoder(stream)
            .pipeThrough(this.encode144p(encodeConfig))
            .pipeThrough(this.renderDecodedFramesAndGetEncodedChunks(renderFrame))
            .pipeThrough(this.transformIntoWebM())
            /* Donwload Video  */
            // .pipeThrough(
            //     new TransformStream({
            //         transform: ({data, position}, controller) => {
            //             this.#buffers.push(data)
            //             controller.enqueue(data);
            //         },
            //         flush: () => {
            //             sendMessage({
            //                 status: 'done',
            //                 buffer: [],
            //                 filename: fileName.concat('-144p.webm')
            //             })
            //         }
            //     })
            // )
            .pipeTo(this.upload(fileName, '144p', 'webm'));

            sendMessage({
                status: 'done'
            });
    }
}