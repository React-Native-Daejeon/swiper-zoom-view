/**
 * 사용에 대한 예시를 담았습니다
 * 사용에 참고하시면 좋습니다
 */

import React from 'react';
import SwiperView from "../src";

class SwiperExample extends React.Component {
    render() {
        return (
            <SwiperView
                //width = {500}
                //height={500}
                //backgroundColor="white"
                initialData={[require("./images/goono_icon1.png"), require("./images/goono_icon2.png")]}
                initialScrollIndex={0}
            />
        )
    }
}


export default SwiperExample;