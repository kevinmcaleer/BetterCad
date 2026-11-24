<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eagle SYSTEM "eagle.dtd">
<eagle version="7.7.0">
<drawing>
<settings><setting alwaysvectorfont="no"/></settings>
<grid distance="0.1" unitdist="inch" unit="inch"/>
<layers>
<layer number="1" name="Top" color="4" fill="1" visible="yes" active="yes"/>
<layer number="16" name="Bottom" color="1" fill="1" visible="yes" active="yes"/>
<layer number="20" name="Dimension" color="15" fill="1" visible="yes" active="yes"/>
<layer number="21" name="tPlace" color="7" fill="1" visible="yes" active="yes"/>
<layer number="91" name="Nets" color="2" fill="1" visible="yes" active="yes"/>
<layer number="94" name="Symbols" color="4" fill="1" visible="yes" active="yes"/>
</layers>
<schematic xreflabel="%F%N/%S.%C%R" xrefpart="/%S.%C%R">
<libraries>
<library name="test">
<description>Parts for the import test</description>
<packages>
<package name="R0805">
<description>&lt;b&gt;Chip resistor&lt;/b&gt;&lt;p&gt;0805, 2012 metric</description>
<smd name="1" x="-0.95" y="0" dx="0.9" dy="1.3" layer="1"/>
<smd name="2" x="0.95" y="0" dx="0.9" dy="1.3" layer="1" roundness="50"/>
<wire x1="-0.4" y1="0.6" x2="0.4" y2="0.6" width="0.127" layer="21"/>
<wire x1="-0.4" y1="-0.6" x2="0.4" y2="-0.6" width="0.127" layer="21"/>
<wire x1="-1.7" y1="1" x2="1.7" y2="1" width="0.05" layer="39"/>
<text x="-1.5" y="1.2" size="0.8" layer="25">&gt;NAME</text>
<text x="-1.5" y="-2" size="0.8" layer="27">&gt;VALUE</text>
<rectangle x1="-0.3" y1="-0.3" x2="0.3" y2="0.3" layer="31"/>
</package>
<package name="SOT23">
<smd name="1" x="-0.95" y="-1.1" dx="0.6" dy="1" layer="1"/>
<smd name="2" x="0.95" y="-1.1" dx="0.6" dy="1" layer="1"/>
<smd name="3" x="0" y="1.1" dx="0.6" dy="1" layer="1"/>
<wire x1="-1.4" y1="0.6" x2="1.4" y2="0.6" width="0.127" layer="51"/>
<circle x="-1.6" y="-1.6" radius="0.15" width="0" layer="21"/>
<text x="-1.5" y="2" size="0.8" layer="25">&gt;NAME</text>
</package>
<package name="HDR3">
<pad name="1" x="-2.54" y="0" drill="1" diameter="1.8" shape="square"/>
<pad name="2" x="0" y="0" drill="1"/>
<pad name="3" x="2.54" y="0" drill="1" diameter="1.6" shape="long" rot="R90"/>
<wire x1="-3.81" y1="1.27" x2="3.81" y2="1.27" width="0.15" layer="21"/>
<wire x1="-3.81" y1="-1.27" x2="3.81" y2="-1.27" width="0.15" layer="21" curve="-20"/>
<text x="-3.8" y="1.6" size="0.8" layer="25">&gt;NAME</text>
</package>
<package name="LED5MM">
<pad name="A" x="-1.27" y="0" drill="0.8" diameter="1.6"/>
<pad name="K" x="1.27" y="0" drill="0.8" diameter="1.6" shape="octagon"/>
<circle x="0" y="0" radius="2.5" width="0.15" layer="21"/>
<polygon width="0.1" layer="21"><vertex x="2" y="-1"/><vertex x="2.6" y="0"/><vertex x="2" y="1"/></polygon>
</package>
<package name="SO8">
<smd name="1" x="-1.905" y="-2.6" dx="0.6" dy="1.5" layer="1"/>
<smd name="2" x="-0.635" y="-2.6" dx="0.6" dy="1.5" layer="1"/>
<smd name="3" x="0.635" y="-2.6" dx="0.6" dy="1.5" layer="1"/>
<smd name="4" x="1.905" y="-2.6" dx="0.6" dy="1.5" layer="1"/>
<smd name="5" x="1.905" y="2.6" dx="0.6" dy="1.5" layer="1"/>
<smd name="6" x="0.635" y="2.6" dx="0.6" dy="1.5" layer="1"/>
<smd name="7" x="-0.635" y="2.6" dx="0.6" dy="1.5" layer="1"/>
<smd name="8" x="-1.905" y="2.6" dx="1.5" dy="0.6" layer="1" rot="R90" roundness="100"/>
<wire x1="-2.4" y1="-1.9" x2="2.4" y2="-1.9" width="0.15" layer="21"/>
<wire x1="-2.4" y1="1.9" x2="2.4" y2="1.9" width="0.15" layer="21"/>
<text x="-2.4" y="3.6" size="0.8" layer="25">&gt;NAME</text>
</package>
<package name="HOLE3">
<hole x="0" y="0" drill="3.2"/>
</package>
<package name="LOGO">
<wire x1="-1" y1="0" x2="1" y2="0" width="0.2" layer="21"/>
</package>
</packages>
<symbols>
<symbol name="R">
<wire x1="-2.54" y1="-0.889" x2="2.54" y2="-0.889" width="0.254" layer="94"/>
<wire x1="2.54" y1="0.889" x2="-2.54" y2="0.889" width="0.254" layer="94"/>
<wire x1="2.54" y1="-0.889" x2="2.54" y2="0.889" width="0.254" layer="94"/>
<wire x1="-2.54" y1="-0.889" x2="-2.54" y2="0.889" width="0.254" layer="94"/>
<text x="-3.81" y="1.4986" size="1.778" layer="95">&gt;NAME</text>
<text x="-3.81" y="-3.302" size="1.778" layer="96">&gt;VALUE</text>
<pin name="2" x="5.08" y="0" visible="off" length="short" direction="pas" rot="R180"/>
<pin name="1" x="-5.08" y="0" visible="off" length="short" direction="pas"/>
</symbol>
<symbol name="LED">
<wire x1="1.27" y1="0" x2="0" y2="-2.54" width="0.254" layer="94"/>
<wire x1="0" y1="-2.54" x2="-1.27" y2="0" width="0.254" layer="94"/>
<wire x1="1.27" y1="-2.54" x2="-1.27" y2="-2.54" width="0.254" layer="94"/>
<wire x1="1.27" y1="0" x2="-1.27" y2="0" width="0.254" layer="94"/>
<polygon width="0.1524" layer="94"><vertex x="-3.429" y="-2.159"/><vertex x="-3.048" y="-1.27"/><vertex x="-2.54" y="-1.778"/></polygon>
<text x="3.556" y="-4.572" size="1.778" layer="95" rot="R90">&gt;NAME</text>
<pin name="C" x="0" y="-5.08" visible="off" length="short" direction="pas" rot="R90"/>
<pin name="A" x="0" y="2.54" visible="off" length="short" direction="pas" rot="R270"/>
</symbol>
<symbol name="NPN">
<wire x1="2.54" y1="2.54" x2="0.508" y2="1.524" width="0.1524" layer="94"/>
<wire x1="1.778" y1="-1.524" x2="2.54" y2="-2.54" width="0.1524" layer="94"/>
<wire x1="2.54" y1="-2.54" x2="0.508" y2="-1.524" width="0.1524" layer="94"/>
<rectangle x1="-0.254" y1="-2.54" x2="0.508" y2="2.54" layer="94"/>
<circle x="1.27" y="0" radius="3.2" width="0.254" layer="94"/>
<text x="5.08" y="0" size="1.778" layer="95">&gt;NAME</text>
<pin name="B" x="-2.54" y="0" visible="off" length="short" direction="pas"/>
<pin name="E" x="2.54" y="-5.08" visible="off" length="short" direction="pas" rot="R90"/>
<pin name="C" x="2.54" y="5.08" visible="off" length="short" direction="pas" rot="R270"/>
</symbol>
<symbol name="HDR3">
<wire x1="-2.54" y1="5.08" x2="2.54" y2="5.08" width="0.254" layer="94"/>
<wire x1="2.54" y1="5.08" x2="2.54" y2="-5.08" width="0.254" layer="94"/>
<wire x1="2.54" y1="-5.08" x2="-2.54" y2="-5.08" width="0.254" layer="94"/>
<wire x1="-2.54" y1="-5.08" x2="-2.54" y2="5.08" width="0.254" layer="94"/>
<text x="-2.54" y="5.842" size="1.778" layer="95">&gt;NAME</text>
<pin name="1" x="-5.08" y="2.54" length="short" direction="pas"/>
<pin name="2" x="-5.08" y="0" length="short" direction="pas"/>
<pin name="3" x="-5.08" y="-2.54" length="short" direction="pas"/>
</symbol>
<symbol name="BUF">
<wire x1="-2.54" y1="5.08" x2="5.08" y2="0" width="0.254" layer="94"/>
<wire x1="5.08" y1="0" x2="-2.54" y2="-5.08" width="0.254" layer="94"/>
<wire x1="-2.54" y1="-5.08" x2="-2.54" y2="5.08" width="0.254" layer="94"/>
<wire x1="-1" y1="1" x2="1" y2="1" width="0.2" layer="94" curve="-180"/>
<text x="-2.54" y="5.842" size="1.778" layer="95">&gt;NAME</text>
<text x="0" y="-1" size="1" layer="94" align="center">1</text>
<pin name="IN" x="-7.62" y="0" visible="pad" length="middle" direction="in"/>
<pin name="OUT" x="7.62" y="0" visible="pad" length="short" direction="out" rot="R180"/>
</symbol>
<symbol name="PWRN">
<text x="1" y="3" size="1.27" layer="95">&gt;NAME</text>
<pin name="VCC" x="0" y="7.62" visible="pad" length="middle" direction="pwr" rot="R270"/>
<pin name="GND" x="0" y="-7.62" visible="pad" length="middle" direction="pwr" rot="R90"/>
</symbol>
<symbol name="GND">
<wire x1="-1.905" y1="0" x2="1.905" y2="0" width="0.254" layer="94"/>
<text x="-2.54" y="-2.54" size="1.778" layer="96">&gt;VALUE</text>
<pin name="GND" x="0" y="2.54" visible="off" length="short" direction="sup" rot="R270"/>
</symbol>
<symbol name="VCC">
<wire x1="1.27" y1="-1.905" x2="0" y2="0" width="0.254" layer="94"/>
<wire x1="0" y1="0" x2="-1.27" y2="-1.905" width="0.254" layer="94"/>
<text x="-2.54" y="-2.54" size="1.778" layer="96" rot="R90">&gt;VALUE</text>
<pin name="VCC" x="0" y="-2.54" visible="off" length="short" direction="sup" rot="R90"/>
</symbol>
<symbol name="FRAME">
<wire x1="0" y1="0" x2="260" y2="0" width="0.4" layer="94"/>
<wire x1="260" y1="0" x2="260" y2="180" width="0.4" layer="94"/>
</symbol>
</symbols>
<devicesets>
<deviceset name="R" prefix="R" uservalue="yes">
<description>&lt;b&gt;Resistor&lt;/b&gt;</description>
<gates><gate name="G$1" symbol="R" x="0" y="0"/></gates>
<devices>
<device name="0805" package="R0805">
<connects><connect gate="G$1" pin="1" pad="1"/><connect gate="G$1" pin="2" pad="2"/></connects>
<technologies><technology name=""><attribute name="MPN" value="RC0805FR-0710KL"/></technology></technologies>
</device>
<device name="AXIAL" package="HDR3">
<connects><connect gate="G$1" pin="1" pad="1"/><connect gate="G$1" pin="2" pad="3"/></connects>
<technologies><technology name=""/></technologies>
</device>
</devices>
</deviceset>
<deviceset name="LED" prefix="D">
<gates><gate name="G$1" symbol="LED" x="0" y="0"/></gates>
<devices><device name="5MM" package="LED5MM">
<connects><connect gate="G$1" pin="A" pad="A"/><connect gate="G$1" pin="C" pad="K"/></connects>
<technologies><technology name=""/></technologies>
</device></devices>
</deviceset>
<deviceset name="NPN-*" prefix="Q">
<gates><gate name="G$1" symbol="NPN" x="0" y="0"/></gates>
<devices><device name="SOT23" package="SOT23">
<connects><connect gate="G$1" pin="B" pad="1"/><connect gate="G$1" pin="E" pad="2"/><connect gate="G$1" pin="C" pad="3"/></connects>
<technologies><technology name="BC817"/><technology name="BC847"/></technologies>
</device></devices>
</deviceset>
<deviceset name="HDR3" prefix="J">
<gates><gate name="G$1" symbol="HDR3" x="0" y="0"/></gates>
<devices><device name="" package="HDR3">
<connects><connect gate="G$1" pin="1" pad="1"/><connect gate="G$1" pin="2" pad="2"/><connect gate="G$1" pin="3" pad="3"/></connects>
<technologies><technology name=""/></technologies>
</device></devices>
</deviceset>
<deviceset name="DUALBUF" prefix="U">
<description>Two buffers in one package</description>
<gates>
<gate name="A" symbol="BUF" x="0" y="10"/>
<gate name="B" symbol="BUF" x="0" y="-10"/>
<gate name="P" symbol="PWRN" x="20" y="0" addlevel="request"/>
</gates>
<devices><device name="D" package="SO8">
<connects>
<connect gate="A" pin="IN" pad="1"/><connect gate="A" pin="OUT" pad="2"/>
<connect gate="B" pin="IN" pad="3"/><connect gate="B" pin="OUT" pad="5"/>
<connect gate="P" pin="GND" pad="4"/><connect gate="P" pin="VCC" pad="8 7"/>
</connects>
<technologies><technology name=""/></technologies>
</device></devices>
</deviceset>
<deviceset name="GND" prefix="GND">
<gates><gate name="1" symbol="GND" x="0" y="0"/></gates>
<devices><device name=""><technologies><technology name=""/></technologies></device></devices>
</deviceset>
<deviceset name="VCC" prefix="P+">
<gates><gate name="1" symbol="VCC" x="0" y="0"/></gates>
<devices><device name=""><technologies><technology name=""/></technologies></device></devices>
</deviceset>
<deviceset name="FRAME" prefix="FRAME">
<gates><gate name="G$1" symbol="FRAME" x="0" y="0"/></gates>
<devices><device name=""><technologies><technology name=""/></technologies></device></devices>
</deviceset>
</devicesets>
</library>
</libraries>
<attributes/>
<variantdefs/>
<classes><class number="0" name="default" width="0.254" drill="0"/><class number="1" name="power" width="0.5" drill="0.4"><clearance class="1" value="0.3"/></class></classes>
<parts>
<part name="R1" library="test" deviceset="R" device="0805" value="330"/>
<part name="R2" library="test" deviceset="R" device="0805" value="10k"/>
<part name="R3" library="test" deviceset="R" device="0805" value="1k"/>
<part name="D1" library="test" deviceset="LED" device="5MM" value="red"/>
<part name="Q1" library="test" deviceset="NPN-*" device="SOT23" technology="BC817"/>
<part name="J1" library="test" deviceset="HDR3" device=""/>
<part name="U1" library="test" deviceset="DUALBUF" device="D"/>
<part name="GND1" library="test" deviceset="GND" device=""/>
<part name="GND2" library="test" deviceset="GND" device=""/>
<part name="GND3" library="test" deviceset="GND" device=""/>
<part name="P+1" library="test" deviceset="VCC" device=""/>
<part name="FRAME1" library="test" deviceset="FRAME" device=""/>
</parts>
<sheets>
<sheet>
<plain><text x="5" y="5" size="2.54" layer="97">Sheet 1 of the test</text><wire x1="5" y1="4" x2="40" y2="4" width="0.15" layer="97"/></plain>
<instances>
<instance part="FRAME1" gate="G$1" x="0" y="0"/>
<instance part="J1" gate="G$1" x="10.16" y="50.8" rot="R180"/>
<instance part="R1" gate="G$1" x="35.56" y="53.34"/>
<instance part="D1" gate="G$1" x="50.8" y="45.72" rot="MR0"/>
<instance part="R2" gate="G$1" x="35.56" y="35.56" rot="R90"/>
<instance part="Q1" gate="G$1" x="60.96" y="27.94" rot="MR180"/>
<instance part="U1" gate="A" x="96.52" y="50.8"/>
<instance part="U1" gate="P" x="119.38" y="50.8"/>
<instance part="GND1" gate="1" x="50.8" y="10.16"/>
<instance part="GND2" gate="1" x="119.38" y="35.56"/>
<instance part="P+1" gate="1" x="30.48" y="55.88"/>
</instances>
<busses><bus name="B$1"><segment><wire x1="100" y1="5" x2="120" y2="5" width="0.762" layer="92"/></segment></bus></busses>
<nets>
<net name="VCC" class="1">
<segment>
<pinref part="J1" gate="G$1" pin="1"/>
<pinref part="R1" gate="G$1" pin="1"/>
<pinref part="P+1" gate="1" pin="VCC"/>
<wire x1="15.24" y1="48.26" x2="27.94" y2="48.26" width="0.1524" layer="91"/>
<wire x1="27.94" y1="48.26" x2="27.94" y2="53.34" width="0.1524" layer="91"/>
<wire x1="27.94" y1="53.34" x2="30.48" y2="53.34" width="0.1524" layer="91"/>
</segment>
<segment>
<pinref part="U1" gate="P" pin="VCC"/>
<wire x1="119.38" y1="58.42" x2="119.38" y2="63.5" width="0.1524" layer="91"/>
<label x="119.38" y="63.5" size="1.778" layer="95" rot="R90"/>
</segment>
</net>
<net name="N$1" class="0">
<segment>
<pinref part="R1" gate="G$1" pin="2"/>
<pinref part="D1" gate="G$1" pin="A"/>
<pinref part="Q1" gate="G$1" pin="C"/>
<wire x1="40.64" y1="53.34" x2="50.8" y2="53.34" width="0.1524" layer="91"/>
<wire x1="50.8" y1="53.34" x2="50.8" y2="48.26" width="0.1524" layer="91"/>
<wire x1="63.5" y1="22.86" x2="68.58" y2="22.86" width="0.1524" layer="91"/>
<wire x1="68.58" y1="22.86" x2="68.58" y2="55.88" width="0.1524" layer="91"/>
<wire x1="68.58" y1="55.88" x2="45.72" y2="55.88" width="0.1524" layer="91"/>
<wire x1="45.72" y1="55.88" x2="45.72" y2="53.34" width="0.1524" layer="91"/>
<junction x="45.72" y="53.34"/>
</segment>
</net>
<net name="GND" class="1">
<segment>
<pinref part="D1" gate="G$1" pin="C"/>
<pinref part="Q1" gate="G$1" pin="E"/>
<pinref part="J1" gate="G$1" pin="3"/>
<pinref part="GND1" gate="1" pin="GND"/>
<wire x1="50.8" y1="40.64" x2="50.8" y2="15.24" width="0.1524" layer="91"/>
<wire x1="50.8" y1="15.24" x2="50.8" y2="12.7" width="0.1524" layer="91"/>
<wire x1="63.5" y1="33.02" x2="63.5" y2="35.56" width="0.1524" layer="91"/>
<wire x1="63.5" y1="35.56" x2="50.8" y2="35.56" width="0.1524" layer="91"/>
<wire x1="15.24" y1="53.34" x2="20.32" y2="53.34" width="0.1524" layer="91"/>
<wire x1="20.32" y1="53.34" x2="20.32" y2="15.24" width="0.1524" layer="91"/>
<wire x1="20.32" y1="15.24" x2="50.8" y2="15.24" width="0.1524" layer="91"/>
<junction x="50.8" y="35.56"/>
<junction x="50.8" y="15.24"/>
</segment>
<segment>
<pinref part="U1" gate="P" pin="GND"/>
<pinref part="GND2" gate="1" pin="GND"/>
<wire x1="119.38" y1="43.18" x2="119.38" y2="38.1" width="0.1524" layer="91"/>
</segment>
</net>
<net name="SIG" class="0">
<segment>
<pinref part="J1" gate="G$1" pin="2"/>
<pinref part="R2" gate="G$1" pin="2"/>
<pinref part="U1" gate="A" pin="IN"/>
<wire x1="15.24" y1="50.8" x2="25.4" y2="50.8" width="0.1524" layer="91"/>
<wire x1="25.4" y1="50.8" x2="25.4" y2="60.96" width="0.1524" layer="91"/>
<wire x1="25.4" y1="60.96" x2="83.82" y2="60.96" width="0.1524" layer="91"/>
<wire x1="83.82" y1="60.96" x2="83.82" y2="50.8" width="0.1524" layer="91"/>
<wire x1="83.82" y1="50.8" x2="88.9" y2="50.8" width="0.1524" layer="91"/>
<wire x1="25.4" y1="50.8" x2="25.4" y2="43.18" width="0.1524" layer="91"/>
<wire x1="25.4" y1="43.18" x2="35.56" y2="43.18" width="0.1524" layer="91"/>
<wire x1="35.56" y1="43.18" x2="35.56" y2="40.64" width="0.1524" layer="91"/>
<junction x="25.4" y="50.8"/>
<label x="70" y="70" size="1.778" layer="95"/>
<label x="60.96" y="60.96" size="1.778" layer="95"/>
</segment>
</net>
<net name="N$2" class="0">
<segment>
<pinref part="R2" gate="G$1" pin="1"/>
<pinref part="Q1" gate="G$1" pin="B"/>
<wire x1="35.56" y1="30.48" x2="35.56" y2="27.94" width="0.1524" layer="91"/>
<wire x1="35.56" y1="27.94" x2="58.42" y2="27.94" width="0.1524" layer="91"/>
</segment>
</net>
<net name="MID" class="0">
<segment>
<pinref part="U1" gate="A" pin="OUT"/>
<wire x1="104.14" y1="50.8" x2="109.22" y2="50.8" width="0.1524" layer="91"/>
</segment>
</net>
</nets></sheet>
<sheet>
<description>Second half</description>
<plain><text x="5" y="5" size="2.54" layer="97">Sheet 2 of the test</text><wire x1="5" y1="4" x2="40" y2="4" width="0.15" layer="97"/></plain>
<instances>
<instance part="U1" gate="B" x="50.8" y="50.8" rot="MR270"/>
<instance part="R3" gate="G$1" x="50.8" y="27.94" rot="R90"/>
<instance part="GND3" gate="1" x="50.8" y="12.7"/>
</instances>
<busses/>
<nets>
<net name="MID" class="0">
<segment>
<pinref part="U1" gate="B" pin="IN"/>
<wire x1="50.8" y1="58.42" x2="50.8" y2="63.5" width="0.1524" layer="91"/>
</segment>
</net>
<net name="OUT" class="0">
<segment>
<pinref part="U1" gate="B" pin="OUT"/>
<pinref part="R3" gate="G$1" pin="2"/>
<wire x1="50.8" y1="43.18" x2="50.8" y2="33.02" width="0.1524" layer="91"/>
</segment>
</net>
<net name="GND" class="1">
<segment>
<pinref part="R3" gate="G$1" pin="1"/>
<pinref part="GND3" gate="1" pin="GND"/>
<wire x1="50.8" y1="22.86" x2="50.8" y2="15.24" width="0.1524" layer="91"/>
</segment>
</net>
</nets></sheet>
</sheets>
</schematic>
</drawing>
</eagle>
