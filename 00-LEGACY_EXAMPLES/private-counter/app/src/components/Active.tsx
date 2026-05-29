import React from 'react';
import { motion } from 'framer-motion';
import './Active.scss'; // Assuming you'll create a corresponding SCSS file

type ActiveProps = {
    clsName: string; // Expected to be "on" or "off"
};

const Active: React.FC<ActiveProps> = ({ clsName }) => {
    return (
        <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={`active ${clsName}`}
        >
            <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={`circle ${clsName}`}
            ></motion.span>
        </motion.div>
    );
};

export default Active;