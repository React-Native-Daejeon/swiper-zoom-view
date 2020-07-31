import React from 'react';
import SwiperView from "./dist";

const App = () => {
    return (
        <SwiperView
            backgroundColor="white"
            initialData={[require("./example/images/goono_icon1.png"), require("./example/images/goono_icon2.png")]}
            initialScrollIndex={0}
        />
    );
};


export default App;
