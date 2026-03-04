# TrustChange


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**agent_id** | **UUID** |  | 
**change_amount** | **int** | Amount to adjust trust score | 
**reason** | **str** | Human-readable reason for change | 
**category** | **str** | Category of trust change | 
**reference_id** | **str** | Optional reference to related record | [optional] 

## Example

```python
from agentanchor.models.trust_change import TrustChange

# TODO update the JSON string below
json = "{}"
# create an instance of TrustChange from a JSON string
trust_change_instance = TrustChange.from_json(json)
# print the JSON string representation of the object
print(TrustChange.to_json())

# convert the object into a dict
trust_change_dict = trust_change_instance.to_dict()
# create an instance of TrustChange from a dict
trust_change_from_dict = TrustChange.from_dict(trust_change_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


